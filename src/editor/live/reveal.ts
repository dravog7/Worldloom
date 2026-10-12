/**
 * Reveal rule for ADR-005 live preview (M1.2 interim, CTO direction):
 * live mode must feel like a word processor — a selection NEVER flips to
 * raw markdown. Only a caret reveals raw syntax, and only on its own line
 * (what you are currently typing into). Construct-scoped reveal (markers of
 * exactly the construct containing the caret, Obsidian-style) is the next
 * refinement, pending the editor-models discovery.
 *
 * Pure over @codemirror/state's `Text` (no DOM, no view) so decorations can
 * be unit-tested headless.
 */

import type { SelectionRange, Text } from "@codemirror/state";

/**
 * @param selections Selection ranges to reveal for (cursor neighbourhood).
 * @param doc        Document the ranges index into (for line boundaries).
 * @returns 1-based line numbers whose raw syntax must stay visible.
 */
export function revealLines(
  selections: readonly SelectionRange[],
  doc: Text,
): Set<number> {
  const lines = new Set<number>();
  for (const range of selections) {
    // Word-like rule: selections reveal nothing — only carets do.
    if (!range.empty) continue;
    lines.add(doc.lineAt(range.head).number);
  }
  return lines;
}
