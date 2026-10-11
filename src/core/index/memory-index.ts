import type { LinkRef, Note, SearchHit } from "../types";
import type { DerivedEdge } from "./edge";
import { deriveEdges } from "./edge";
import { nameMatchTier } from "./fuzzy";
import { InvertedIndex, tokenize } from "./inverted-index";
import type { IndexSidecar } from "./json-persist";
import { deserializeSidecar, serializeSidecar, SIDECAR_VERSION } from "./json-persist";
import type { IndexProvider } from "./provider";
import type { IndexStorage } from "./storage";
import { MemoryIndexStorage } from "./storage";

const PHRASE_BOOST = 5;
const TITLE_TOKEN_BOOST = 2;
const SNIPPET_BEFORE = 24;
const SNIPPET_LENGTH = 60;
const EMPTY_TOKENS: ReadonlySet<string> = new Set();

export interface MemoryIndexOptions {
  /** Vault hash stamped into the sidecar and re-checked on load(). */
  vaultHash?: string;
  /** Persistence port (ADR-003 sidecar); defaults to in-memory storage. */
  storage?: IndexStorage;
}

/**
 * In-memory IndexProvider (ADR-003): notes map by path, derived edge list
 * (wikilinks + typed frontmatter relations), case-insensitive title/alias
 * map, token inverted index, and a version+vaultHash-stamped JSON sidecar.
 *
 * load() returns false on missing/corrupt/mismatched sidecars and leaves
 * current state untouched — the caller (vault service) rebuilds from disk;
 * this class never re-parses the vault itself (pure core, ARCH.md).
 */
export class MemoryIndex implements IndexProvider {
  readonly vaultHash: string;

  private readonly storage: IndexStorage;
  private readonly notes = new Map<string, Note>();
  /** lowercase title/alias → paths of the notes owning that name */
  private readonly names = new Map<string, Set<string>>();
  private readonly inverted = new InvertedIndex();
  private readonly titleTokens = new Map<string, Set<string>>();
  /** lowercase title+aliases+tags+body text for phrase boost and snippets */
  private readonly searchText = new Map<string, string>();
  private readonly edgesBySource = new Map<string, DerivedEdge[]>();
  /** lazily rebuilt: link edges grouped by resolved target path */
  private backlinksByTarget: Map<string, DerivedEdge[]> | null = null;

  constructor(options: MemoryIndexOptions = {}) {
    this.vaultHash = options.vaultHash ?? "";
    this.storage = options.storage ?? new MemoryIndexStorage();
  }

  upsert(note: Note): void {
    if (this.notes.has(note.path)) this.purge(note.path);
    // Defensive copy: callers (parser/watcher) may reuse their note objects.
    const stored: Note = {
      ...note,
      aliases: [...note.aliases],
      tags: [...note.tags],
      relations: note.relations.map((relation) => ({ ...relation })),
      links: note.links.map((link) => ({ ...link })),
    };
    this.notes.set(stored.path, stored);

    for (const name of [stored.title, ...stored.aliases]) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      let paths = this.names.get(key);
      if (!paths) {
        paths = new Set();
        this.names.set(key, paths);
      }
      paths.add(stored.path);
    }

    this.inverted.add(stored.path, tokenize(combinedText(stored)));
    this.titleTokens.set(stored.path, new Set(tokenize(stored.title)));
    this.searchText.set(stored.path, combinedText(stored).toLowerCase());
    this.edgesBySource.set(stored.path, deriveEdges(stored));
    this.backlinksByTarget = null;
  }

  remove(path: string): void {
    if (!this.notes.has(path)) return;
    this.purge(path);
  }

  /**
   * Fuzzy title/alias lookup feeding [[autocomplete]]: exact > prefix >
   * ordered subsequence; ties broken by title length, then alphabet, then
   * path. Aliases resolve to their canonical note. Duplicate aliases across
   * notes are tolerated — every owner resolves, in deterministic order.
   */
  byTitleOrAlias(q: string): Note[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const best = new Map<string, { note: Note; tier: number }>();
    for (const [name, paths] of this.names) {
      const tier = nameMatchTier(needle, name);
      if (tier === -1) continue;
      for (const path of paths) {
        const note = this.notes.get(path);
        if (!note) continue;
        const existing = best.get(path);
        if (!existing || tier < existing.tier) best.set(path, { note, tier });
      }
    }
    return [...best.values()]
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          a.note.title.length - b.note.title.length ||
          a.note.title.toLowerCase().localeCompare(b.note.title.toLowerCase()) ||
          a.note.path.localeCompare(b.note.path),
      )
      .map((match) => match.note);
  }

  /** Incoming wikilinks resolved to `path` (relations excluded — typed edges). */
  backlinks(path: string): LinkRef[] {
    this.ensureBacklinks();
    const edges = this.backlinksByTarget?.get(path);
    return edges ? edges.map(toLinkRef) : [];
  }

  /** Outgoing wikilinks of `path` (relations excluded — see edges()). */
  links(path: string): LinkRef[] {
    return (this.edgesBySource.get(path) ?? [])
      .filter((edge) => edge.provenance === "link")
      .map(toLinkRef);
  }

  /**
   * Inverted-index search: every query token must match (AND), exact-phrase
   * and title hits boost the score; ties break by title then path.
   */
  search(query: string): SearchHit[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];
    const candidates = new Set(this.inverted.pathsFor(tokens[0] as string));
    if (candidates.size === 0) return [];
    for (const token of tokens.slice(1)) {
      const posting = this.inverted.pathsFor(token);
      if (posting.size === 0) return [];
      for (const path of [...candidates]) {
        if (!posting.has(path)) candidates.delete(path);
      }
    }
    const phrase = query.trim().toLowerCase();
    const hits: SearchHit[] = [];
    for (const path of candidates) {
      const note = this.notes.get(path);
      if (!note) continue;
      let score = 0;
      const titleTokens = this.titleTokens.get(path) ?? EMPTY_TOKENS;
      for (const token of tokens) {
        score += 1;
        if (titleTokens.has(token)) score += TITLE_TOKEN_BOOST;
      }
      const text = this.searchText.get(path) ?? "";
      if (text.includes(phrase)) score += PHRASE_BOOST;
      const snippet = snippetAround(note.body, tokens);
      hits.push({
        path,
        title: note.title,
        score,
        ...(snippet !== undefined ? { snippet } : {}),
      });
    }
    return hits.sort(
      (a, b) =>
        b.score - a.score ||
        a.title.toLowerCase().localeCompare(b.title.toLowerCase()) ||
        a.path.localeCompare(b.path),
    );
  }

  all(): Note[] {
    return [...this.notes.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Derived edges (wikilinks + typed relations), optionally for one source. */
  edges(sourcePath?: string): DerivedEdge[] {
    if (sourcePath !== undefined) return [...(this.edgesBySource.get(sourcePath) ?? [])];
    return [...this.edgesBySource.values()].flat();
  }

  /** Writes the `{version, vaultHash, notes, edges}` sidecar via storage. */
  async persist(): Promise<void> {
    const sidecar: IndexSidecar = {
      version: SIDECAR_VERSION,
      vaultHash: this.vaultHash,
      notes: this.all(),
      edges: this.edges(),
    };
    await this.storage.write(serializeSidecar(sidecar));
  }

  /**
   * Loads a sidecar via storage. Returns false on missing storage contents,
   * corrupt JSON, unsupported version, or vaultHash mismatch — current state
   * is kept untouched and the caller rebuilds the index from the vault.
   * On success notes are re-upserted (edges are re-derived from them).
   */
  async load(): Promise<boolean> {
    const text = await this.storage.read();
    if (text === null) return false;
    const sidecar = deserializeSidecar(text, this.vaultHash);
    if (!sidecar) return false;
    for (const path of [...this.notes.keys()]) this.purge(path);
    for (const note of sidecar.notes) this.upsert(note);
    return true;
  }

  private purge(path: string): void {
    const note = this.notes.get(path);
    this.notes.delete(path);
    if (note) {
      for (const name of [note.title, ...note.aliases]) {
        const key = name.trim().toLowerCase();
        const paths = this.names.get(key);
        if (!paths) continue;
        paths.delete(path);
        if (paths.size === 0) this.names.delete(key);
      }
    }
    this.inverted.remove(path);
    this.titleTokens.delete(path);
    this.searchText.delete(path);
    this.edgesBySource.delete(path);
    this.backlinksByTarget = null;
  }

  private ensureBacklinks(): void {
    if (this.backlinksByTarget !== null) return;
    const map = new Map<string, DerivedEdge[]>();
    for (const edges of this.edgesBySource.values()) {
      for (const edge of edges) {
        if (edge.provenance !== "link") continue;
        const targetPath = this.resolveTarget(edge.target);
        if (!targetPath) continue;
        let list = map.get(targetPath);
        if (!list) {
          list = [];
          map.set(targetPath, list);
        }
        list.push(edge);
      }
    }
    this.backlinksByTarget = map;
  }

  /** Resolves a link target: path as written, path + .md, then title/alias. */
  private resolveTarget(target: string): string | undefined {
    if (this.notes.has(target)) return target;
    const withExtension = target.endsWith(".md") ? target : `${target}.md`;
    if (this.notes.has(withExtension)) return withExtension;
    const paths = this.names.get(target.trim().toLowerCase());
    // Duplicate aliases: deterministic first path wins for resolution.
    return paths && paths.size > 0 ? [...paths].sort()[0] : undefined;
  }
}

function combinedText(note: Note): string {
  return [note.title, ...note.aliases, ...note.tags, note.body].join(" ");
}

function toLinkRef(edge: DerivedEdge): LinkRef {
  return {
    source: edge.source,
    target: edge.target,
    line: edge.line,
    ...(edge.display !== undefined ? { display: edge.display } : {}),
  };
}

/** Short body excerpt centered on the first occurrence of any query token. */
function snippetAround(body: string, tokens: string[]): string | undefined {
  if (!body) return undefined;
  const lower = body.toLowerCase();
  let first = -1;
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index !== -1 && (first === -1 || index < first)) first = index;
  }
  if (first === -1) return undefined;
  const start = Math.max(0, first - SNIPPET_BEFORE);
  const end = Math.min(body.length, first + SNIPPET_LENGTH);
  const core = body.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${core}${end < body.length ? "…" : ""}`;
}
