import type { Note } from "../types";
import type { IndexProvider } from "../index/provider";
import type { DirEntry, FsPort } from "./fs-port";
import { contentHash } from "./hash";
import { generateStubNote, slugifyFileName } from "./stub";
import { type TimerPort, systemTimer } from "./timer";

/** Watcher event kinds (tauri-plugin-watcher emits create/change/delete). */
export type ChangeKind = "create" | "update" | "delete";

/** Matches the parser contract (B1) — injected, never imported. */
export type ParseNoteFn = (path: string, content: string) => Note;

export interface VaultServiceDeps {
  fs: FsPort;
  parseNote: ParseNoteFn;
  index: IndexProvider;
  /** Defaults to real timers; tests inject ManualTimer. */
  timer?: TimerPort;
}

/** Debounce window per ARCH.md data flow: watcher event → 150ms → parse. */
export const VAULT_DEBOUNCE_MS = 150;

/** Thrown when a vault-relative operation happens before buildIndex(root). */
export class VaultNotOpenError extends Error {
  constructor(operation: string) {
    super(`${operation} requires an open vault — call buildIndex(root) first`);
    this.name = "VaultNotOpenError";
  }
}

interface PendingChange {
  kind: ChangeKind;
  handle: unknown;
}

/**
 * Vault service (PLAN-M1 B3). All disk/index/parser/timer access is injected,
 * so this class is pure orchestration logic — fully unit-testable headless.
 *
 * Change pipeline (ARCH.md): watcher event → applyChange(path, kind) →
 * per-path trailing debounce(150ms) → content-hash journal check (skips our
 * own saves, killing watcher feedback loops) → parseNote → index.upsert/remove.
 */
export class VaultService {
  private readonly fs: FsPort;
  private readonly parseNote: ParseNoteFn;
  private readonly index: IndexProvider;
  private readonly timer: TimerPort;

  /** Vault root from the last buildIndex/scanVault call (forward slashes). */
  private root: string | null = null;
  /** Latest debounced change per vault-relative path. */
  private readonly pending = new Map<string, PendingChange>();
  /** Content-hash journal: last content we wrote or indexed, per path. */
  private readonly lastHashByPath = new Map<string, string>();

  constructor(deps: VaultServiceDeps) {
    this.fs = deps.fs;
    this.parseNote = deps.parseNote;
    this.index = deps.index;
    this.timer = deps.timer ?? systemTimer;
  }

  /** Recursively lists vault-relative .md paths, sorted; skips dot-dirs,
   * .git and node_modules, and everything non-markdown. */
  async scanVault(root: string): Promise<string[]> {
    const found: string[] = [];
    await this.walk(root, "", found);
    return found.sort();
  }

  /** Full (re)build: parse every note in the vault, drop stale entries,
   * journal content hashes so watcher echoes of this scan stay silent. */
  async buildIndex(root: string): Promise<IndexProvider> {
    this.root = normalizeSlashes(root).replace(/\/+$/, "");
    const live = new Set(await this.scanVault(root));
    for (const note of this.index.all()) {
      if (!live.has(note.path)) {
        this.index.remove(note.path);
        this.lastHashByPath.delete(note.path);
      }
    }
    for (const rel of live) {
      const content = await this.fs.readText(this.absolute(rel));
      this.index.upsert(this.parseNote(rel, content));
      this.lastHashByPath.set(rel, contentHash(content));
    }
    return this.index;
  }

  /**
   * Queues a watcher event: debounced 150ms per path (trailing edge — latest
   * event kind wins). `path` may be vault-relative or an absolute watcher
   * path (any separator); it is normalized to vault-relative identity.
   */
  applyChange(path: string, kind: ChangeKind): void {
    const rel = this.toVaultRelative(path, "applyChange");
    const existing = this.pending.get(rel);
    if (existing) this.timer.clearTimeout(existing.handle);
    const handle = this.timer.setTimeout(() => {
      this.pending.delete(rel);
      void this.processChange(rel, kind);
    }, VAULT_DEBOUNCE_MS);
    this.pending.set(rel, { kind, handle });
  }

  /** Processes every pending change immediately (test/shutdown helper):
   * cancels the timers so nothing fires twice. */
  async flushPending(): Promise<void> {
    const due = [...this.pending.entries()];
    this.pending.clear();
    for (const [, change] of due) this.timer.clearTimeout(change.handle);
    for (const [rel, change] of due) await this.processChange(rel, change.kind);
  }

  /** Atomic save (FsPort contract: temp sibling + rename), then upsert into
   * the index and journal the hash so the watcher echo is suppressed. */
  async saveNote(path: string, content: string): Promise<Note> {
    const rel = this.toVaultRelative(path, "saveNote");
    const note = this.parseNote(rel, content);
    await this.fs.writeText(this.absolute(rel), content);
    this.index.upsert(note);
    this.lastHashByPath.set(rel, contentHash(content));
    return note;
  }

  /**
   * Creates a stub note for an unresolved wikilink target: slug filename
   * (collision-safe counter), minimal v1 frontmatter, then registers it in
   * the index. Returns the vault-relative path of the new note.
   */
  async createStub(root: string, linkTitle: string): Promise<string> {
    const slug = slugifyFileName(linkTitle);
    let rel = `${slug}.md`;
    for (let n = 2; await this.fs.exists(this.absolute(root, rel)); n++) {
      rel = `${slug} ${n}.md`;
    }
    const content = generateStubNote(linkTitle);
    await this.fs.writeText(this.absolute(root, rel), content);
    if (this.root === normalizeSlashes(root).replace(/\/+$/, "")) {
      this.index.upsert(this.parseNote(rel, content));
      this.lastHashByPath.set(rel, contentHash(content));
    }
    return rel;
  }

  private async processChange(rel: string, kind: ChangeKind): Promise<void> {
    if (kind === "delete") {
      this.index.remove(rel);
      this.lastHashByPath.delete(rel);
      return;
    }
    let content: string;
    try {
      content = await this.fs.readText(this.absolute(rel));
    } catch {
      // File vanished between the event and processing — treat as removal.
      this.index.remove(rel);
      this.lastHashByPath.delete(rel);
      return;
    }
    const hash = contentHash(content);
    if (this.lastHashByPath.get(rel) === hash) {
      // Self-write echo (or a no-op event): our save already updated the index.
      return;
    }
    this.index.upsert(this.parseNote(rel, content));
    this.lastHashByPath.set(rel, hash);
  }

  private async walk(root: string, rel: string, found: string[]): Promise<void> {
    const base = normalizeSlashes(root).replace(/\/+$/, "");
    const entries: DirEntry[] = await this.fs.readDir(rel ? `${base}/${rel}` : base);
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (isSkippedDir(entry.name)) continue;
        await this.walk(root, childRel, found);
      } else if (/\.md$/i.test(entry.name)) {
        found.push(childRel);
      }
    }
  }

  /** Vault-relative → absolute path under the open vault root. */
  private absolute(rel: string): string;
  /** Explicit root (may be a not-yet-open vault, e.g. createStub) + rel. */
  private absolute(root: string, rel: string): string;
  private absolute(a: string, b?: string): string {
    if (b === undefined) {
      return `${this.assertRoot("absolute")}/${normalizeSlashes(a).replace(/^\.?\//, "")}`;
    }
    const base = normalizeSlashes(a).replace(/\/+$/, "");
    return `${base}/${normalizeSlashes(b).replace(/^\.?\//, "")}`;
  }

  private toVaultRelative(path: string, operation: string): string {
    const root = this.assertRoot(operation);
    let normalized = normalizeSlashes(path);
    if (normalized.startsWith(`${root}/`)) normalized = normalized.slice(root.length + 1);
    return normalized.replace(/^\.\//, "");
  }

  private assertRoot(operation: string): string {
    if (this.root === null) throw new VaultNotOpenError(operation);
    return this.root;
  }
}

function isSkippedDir(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

function normalizeSlashes(path: string): string {
  return path.split("\\").join("/");
}
