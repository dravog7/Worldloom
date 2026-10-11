import type { LinkRef, Note, SearchHit } from "../types";
import type { IndexProvider } from "../index/provider";
import type { DirEntry, FsPort } from "./fs-port";
import type { ParseNoteFn } from "./vault-service";

/** In-memory FsPort fake with call recording (B3 unit tests). */
export class FakeFs implements FsPort {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly writes: { path: string; content: string }[] = [];
  readTextCalls = 0;

  constructor(entries: Record<string, string> = {}, dirs: string[] = []) {
    for (const [path, content] of Object.entries(entries)) {
      this.files.set(normalize(path), content);
    }
    for (const dir of dirs) this.dirs.add(normalize(dir));
    // Auto-register every ancestor directory of every file.
    for (const path of this.files.keys()) {
      let idx = path.indexOf("/");
      while (idx > 0) {
        this.dirs.add(path.slice(0, idx));
        idx = path.indexOf("/", idx + 1);
      }
    }
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const base = normalize(path);
    const entries = new Map<string, boolean>();
    for (const dir of this.dirs) {
      const slash = dir.lastIndexOf("/");
      if (slash > 0 && dir.slice(0, slash) === base) entries.set(dir.slice(slash + 1), true);
    }
    for (const file of this.files.keys()) {
      const slash = file.lastIndexOf("/");
      if (slash > 0 && file.slice(0, slash) === base) entries.set(file.slice(slash + 1), false);
    }
    return [...entries].map(([name, isDirectory]) => ({ name, isDirectory }));
  }

  async readText(path: string): Promise<string> {
    this.readTextCalls += 1;
    const content = this.files.get(normalize(path));
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  async writeText(path: string, content: string): Promise<void> {
    this.writes.push({ path: normalize(path), content });
    this.files.set(normalize(path), content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(normalize(path)) || this.dirs.has(normalize(path));
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(normalize(path));
  }

  async rename(from: string, to: string): Promise<void> {
    const content = this.files.get(normalize(from));
    if (content === undefined) throw new Error(`ENOENT rename: ${from}`);
    this.files.delete(normalize(from));
    this.files.set(normalize(to), content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(normalize(path));
  }
}

/** Minimal IndexProvider fake: records upserts/removes, serves all(). */
export class FakeIndex implements IndexProvider {
  readonly upserted: Note[] = [];
  readonly removed: string[] = [];
  private readonly notes = new Map<string, Note>();

  upsert(note: Note): void {
    this.upserted.push(note);
    this.notes.set(note.path, note);
  }

  remove(path: string): void {
    this.removed.push(path);
    this.notes.delete(path);
  }

  byTitleOrAlias(): Note[] {
    return [];
  }
  backlinks(): LinkRef[] {
    return [];
  }
  links(): LinkRef[] {
    return [];
  }
  search(): SearchHit[] {
    return [];
  }

  all(): Note[] {
    return [...this.notes.values()];
  }

  async persist(): Promise<void> {}
  async load(): Promise<boolean> {
    return false;
  }
}

export function makeNote(path: string, extra: Partial<Note> = {}): Note {
  const stem = path.split("/").pop() ?? path;
  return {
    path,
    title: stem.replace(/\.md$/, ""),
    aliases: [],
    tags: [],
    relations: [],
    body: "",
    links: [],
    mtime: 0,
    ...extra,
  };
}

/** Fake parser: H1 title + [[wikilink]] extraction (enough for vault logic). */
export const fakeParseNote: ParseNoteFn = (path, content) => {
  const h1 = content.match(/^# (.+)$/m);
  const stem = path.split("/").pop() ?? path;
  const links: LinkRef[] = [...content.matchAll(/\[\[([^[\]\n]+)\]\]/g)].map((m) => {
    const [target, display] = m[1].split("|");
    const ref: LinkRef = { source: path, target: target.trim(), line: 0 };
    if (display !== undefined) ref.display = display.trim();
    return ref;
  });
  return makeNote(path, {
    title: h1 ? h1[1].trim() : stem.replace(/\.md$/, ""),
    body: content,
    links,
  });
};

/** Resolve once so timers scheduled against real microtasks can settle. */
export function drainMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalize(path: string): string {
  return path.split("\\").join("/").replace(/\/+$/, "");
}
