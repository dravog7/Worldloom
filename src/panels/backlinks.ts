/**
 * Backlinks grouping (PLAN-M1 C3). Turns the flat LinkRef[] from
 * IndexProvider.backlinks(path) into per-source groups for the panel:
 * groups ordered by source path (deterministic render order), links inside a
 * group ordered by their line number (top of file first).
 */
import type { LinkRef } from "../core/types";

export interface BacklinkGroup {
  /** Vault-relative path of the note containing the links. */
  path: string;
  /** Links from that note, sorted by line ascending. */
  links: LinkRef[];
}

/** Pure grouping: no mutation of the input array or its links. */
export function groupBacklinks(links: readonly LinkRef[]): BacklinkGroup[] {
  const bySource = new Map<string, LinkRef[]>();
  for (const link of links) {
    const bucket = bySource.get(link.source);
    if (bucket) bucket.push(link);
    else bySource.set(link.source, [link]);
  }
  return [...bySource.entries()]
    .map(([path, groupLinks]) => ({
      path,
      links: [...groupLinks].sort((a, b) => a.line - b.line),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
