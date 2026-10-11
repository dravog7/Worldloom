import { NotImplementedError } from "../errors";
import type { IndexProvider } from "./provider";
import type { LinkRef, Note, SearchHit } from "../types";

/**
 * In-memory IndexProvider (ADR-003): notes map, edge list, alias map,
 * token inverted index; JSON sidecar persist with version+vaultHash stamp.
 *
 * Wave A stub — replaced by B2.
 */
export class MemoryIndex implements IndexProvider {
  upsert(_note: Note): void {
    throw new NotImplementedError("MemoryIndex.upsert");
  }

  remove(_path: string): void {
    throw new NotImplementedError("MemoryIndex.remove");
  }

  byTitleOrAlias(_q: string): Note[] {
    throw new NotImplementedError("MemoryIndex.byTitleOrAlias");
  }

  backlinks(_path: string): LinkRef[] {
    throw new NotImplementedError("MemoryIndex.backlinks");
  }

  links(_path: string): LinkRef[] {
    throw new NotImplementedError("MemoryIndex.links");
  }

  search(_query: string): SearchHit[] {
    throw new NotImplementedError("MemoryIndex.search");
  }

  all(): Note[] {
    throw new NotImplementedError("MemoryIndex.all");
  }

  async persist(): Promise<void> {
    throw new NotImplementedError("MemoryIndex.persist");
  }

  async load(): Promise<void> {
    throw new NotImplementedError("MemoryIndex.load");
  }
}
