/**
 * Core note model — frontmatter v1 schema per ADR-002 and ARCH.md.
 * All waves consume these types; parser (B1) produces them, index (B2)
 * stores them, UI waves render them.
 */

/** Typed edge from frontmatter `relations` (ADR-002). */
export interface Relation {
  kind: string;
  target: string;
}

/** Free-form era labels (ADR-002); parsed dates arrive in M3. */
export interface Temporal {
  from?: string;
  to?: string;
}

/** A resolved wikilink reference attached to its source note. */
export interface LinkRef {
  /** Vault-relative path of the note containing the link. */
  source: string;
  /** Link target as written ([[Target]] → "Target"); unresolved names allowed. */
  target: string;
  /** 0-based line number of the link within the source note. */
  line: number;
  /** Display text from pipe form [[Target|display]]. */
  display?: string;
}

/** One note in the vault (ADR-002 note format v1). */
export interface Note {
  /** Vault-relative path, e.g. "places/Vael'Thor.md". Identity per ADR-002. */
  path: string;
  /** First H1 heading, falling back to the filename stem. */
  title: string;
  /** character|place|event|faction|item|concept|campaign|session (free string). */
  type?: string;
  aliases: string[];
  tags: string[];
  /** Typed edges from frontmatter. */
  relations: Relation[];
  temporal?: Temporal;
  /** Markdown body without frontmatter. */
  body: string;
  /** Wikilinks extracted from the body (untyped edges). */
  links: LinkRef[];
  /** File modification time, epoch ms (index staleness guard). */
  mtime: number;
}

/** One search result from IndexProvider.search (contract owned by ADR-003). */
export interface SearchHit {
  path: string;
  title: string;
  /** Higher is better; phrase matches boosted (ADR-003). */
  score: number;
  /** Short body excerpt around the first match, if available. */
  snippet?: string;
}
