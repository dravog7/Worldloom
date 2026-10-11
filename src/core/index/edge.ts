import type { Note } from "../types";

/** Where a derived edge came from (ADR-003 / ARCH edge model). */
export type EdgeProvenance = "link" | "relation";

/**
 * One derived edge: an untyped wikilink or a typed frontmatter relation.
 * Relations carry `kind`; wikilinks carry the 0-based `line` (and optional
 * pipe `display`), relations use line -1.
 */
export interface DerivedEdge {
  source: string;
  target: string;
  /** Relation kind; "" for wikilinks. */
  kind: string;
  provenance: EdgeProvenance;
  /** 0-based line for links; -1 for relations. */
  line: number;
  display?: string;
}

/** Derives all edges for one note: wikilinks first, then typed relations. */
export function deriveEdges(note: Note): DerivedEdge[] {
  const linkEdges = note.links.map(
    (link): DerivedEdge => ({
      source: note.path,
      target: link.target,
      kind: "",
      provenance: "link",
      line: link.line,
      ...(link.display !== undefined ? { display: link.display } : {}),
    }),
  );
  const relationEdges = note.relations.map(
    (relation): DerivedEdge => ({
      source: note.path,
      target: relation.target,
      kind: relation.kind,
      provenance: "relation",
      line: -1,
    }),
  );
  return [...linkEdges, ...relationEdges];
}

/** Structural validation for sidecar-loaded edges. */
export function isDerivedEdge(value: unknown): value is DerivedEdge {
  if (typeof value !== "object" || value === null) return false;
  const edge = value as Record<string, unknown>;
  return (
    typeof edge.source === "string" &&
    typeof edge.target === "string" &&
    typeof edge.kind === "string" &&
    (edge.provenance === "link" || edge.provenance === "relation") &&
    typeof edge.line === "number"
  );
}
