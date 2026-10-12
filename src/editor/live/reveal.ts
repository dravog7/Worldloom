/**
 * Construct-scoped reveal rule for ADR-005 live preview (per
 * docs/DISCOVERY-editor-models.md §3–§4): live mode must feel like a word
 * processor. Research consensus across Typora/Obsidian (§1.1, §1.2): all
 * markdown markers are hidden at rest, and raw syntax is revealed *only* for
 * the construct the caret is actually inside — never whole lines, never a
 * merely-selected region (no reference editor reveals syntax for a
 * selection; §1 synthesis).
 *
 * A non-empty selection reveals a construct only when it *partially cuts*
 * it — exactly one endpoint in the construct's strict interior. That is the
 * §4.2.4 cursor-jump guard: a hidden marker the selection straddles must
 * become visible, or the selection appears to swallow invisible bytes.
 * A selection fully containing or fully inside a construct overlaps no
 * construct boundary and reveals nothing.
 *
 * Pure over document positions (no DOM, no view, no tree) so decorations
 * can be unit-tested headless; `head`-based caret containment is inclusive
 * so typing at a construct's end keeps its markers on screen.
 */

import type { SelectionRange } from "@codemirror/state";

/**
 * @param from        Start position of the construct (its syntax node span).
 * @param to          End position of the construct (its syntax node span).
 * @param selections All selection ranges (multi-cursor aware).
 * @returns Whether the construct's raw syntax must stay visible.
 */
export function isConstructRevealed(
  from: number,
  to: number,
  selections: readonly SelectionRange[],
): boolean {
  for (const range of selections) {
    if (range.empty) {
      // Word-like rule: a caret inside — or at either edge of — the
      // construct reveals exactly that construct.
      if (range.head >= from && range.head <= to) return true;
      continue;
    }
    // Selection: reveal only on a partial cut (exactly one endpoint in the
    // strict interior). Fully containing / fully inside reveal nothing.
    const cutsAtStart = range.from > from && range.from < to;
    const cutsAtEnd = range.to > from && range.to < to;
    if (cutsAtStart !== cutsAtEnd) return true;
  }
  return false;
}
