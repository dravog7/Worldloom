import type { LinkRef, Note, SearchHit } from "../types";

/**
 * Index contract — VERBATIM from ADR-003. This interface is the boundary
 * between index implementations (MemoryIndex now; SqliteFts5Index only if
 * the ADR-003 scale gate trips) and every consumer ([[autocomplete]],
 * backlinks panel, search palette, M2 auditor). Do not extend without an
 * ADR update.
 */
export interface IndexProvider {
  upsert(note: Note): void
  remove(path: string): void
  byTitleOrAlias(q: string): Note[]      // fuzzy; feeds [[autocomplete]]
  backlinks(path: string): LinkRef[]
  links(path: string): LinkRef[]
  search(query: string): SearchHit[]     // tokens + phrase boost
  all(): Note[]
  persist(): Promise<void>; load(): Promise<void>
}
