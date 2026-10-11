/**
 * Reveal rule for ADR-005 live preview: which lines show raw markdown.
 *
 * A non-empty selection reveals exactly the lines it spans — selecting text
 * is precise intent (the user is looking at those lines). A caret reveals
 * its own line *and the immediate neighbours* (head line ± 1): while typing
 * at a construct's edge — right after a heading's hash run, inside a
 * wikilink, at a blockquote boundary — the neighbouring line's syntax stays
 * legible instead of flickering in and out under the cursor.
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
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
    if (range.empty) {
      // Caret: keep the neighbouring lines' syntax visible too.
      if (first > 1) lines.add(first - 1);
      if (last < doc.lines) lines.add(last + 1);
    }
  }
  return lines;
}
