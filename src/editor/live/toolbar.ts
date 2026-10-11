/**
 * Formatting toolbar for ADR-005 live preview: pure transaction builders
 * over @codemirror/state — no view, no dispatch — so every button's
 * behaviour is unit-testable in plain Node.
 *
 * Inline actions wrap the selection in markdown markers and toggle back off
 * when the markers are already inside or immediately around the selection;
 * line actions toggle `# `/`## `/`> `/`- ` prefixes per touched line
 * (converting an existing heading prefix instead of stacking).
 *
 * Known edge: with multiple selections, an "outer marker" toggle reads the
 * characters just outside each range; two *adjacent* selections could then
 * produce overlapping change specs. CodeMirror rejects overlapping changes,
 * so keep multi-cursor selections non-adjacent (CM itself also never creates
 * overlapping ranges).
 */

import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type SelectionRange,
  type Transaction,
} from "@codemirror/state";

export type ToolbarAction =
  | "bold"
  | "italic"
  | "h1"
  | "h2"
  | "quote"
  | "bullet"
  | "wikilink"
  | "code";

type InlineAction = "bold" | "italic" | "code";

const INLINE_MARKERS: Record<InlineAction, { open: string; close: string }> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  code: { open: "`", close: "`" },
};

const LINE_ACTIONS = ["h1", "h2", "quote", "bullet"] as const;
type LineAction = (typeof LINE_ACTIONS)[number];

const LINE_PREFIX: Record<LineAction, string> = {
  h1: "# ",
  h2: "## ",
  quote: "> ",
  bullet: "- ",
};

function isInline(action: ToolbarAction): action is InlineAction {
  return action === "bold" || action === "italic" || action === "code";
}

function isLine(action: ToolbarAction): action is LineAction {
  return (LINE_ACTIONS as readonly string[]).includes(action);
}

function commit(
  state: EditorState,
  changes: ChangeSpec[],
  ranges: readonly SelectionRange[],
): Transaction | null {
  if (changes.length === 0) return null;
  return state.update({
    changes,
    selection: EditorSelection.create(
      [...ranges],
      state.selection.mainIndex,
    ),
  });
}

function applyInline(
  state: EditorState,
  markers: { open: string; close: string },
): Transaction | null {
  // Deletions omit `insert`; every spec stays a valid ChangeSpec.
  const changes: Array<{ from: number; to: number; insert?: string }> = [];
  const ranges: SelectionRange[] = [];
  const { open, close } = markers;
  for (const range of state.selection.ranges) {
    const { from, to } = range;
    if (range.empty) {
      // Empty selection: insert an empty span, cursor in the interior.
      changes.push({ from, to: from, insert: open + close });
      ranges.push(EditorSelection.cursor(from + open.length));
      continue;
    }
    const inner = state.doc.sliceString(from, to);
    const before = state.doc.sliceString(Math.max(0, from - open.length), from);
    const after = state.doc.sliceString(
      to,
      Math.min(state.doc.length, to + close.length),
    );
    if (
      inner.length >= open.length + close.length &&
      inner.startsWith(open) &&
      inner.endsWith(close)
    ) {
      // Markers inside the selection → toggle off, keep the text selected.
      changes.push({ from, to: from + open.length });
      changes.push({ from: to - close.length, to });
      ranges.push(EditorSelection.range(from, to - open.length - close.length));
    } else if (before === open && after === close) {
      // Markers immediately around the selection → toggle off too.
      changes.push({ from: from - open.length, to: from });
      changes.push({ from: to, to: to + close.length });
      ranges.push(EditorSelection.range(from - open.length, to - open.length));
    } else {
      // Wrap the selection; keep the wrapped text selected.
      changes.push({ from, to: from, insert: open });
      changes.push({ from: to, to: to, insert: close });
      ranges.push(EditorSelection.range(from + open.length, to + open.length));
    }
  }
  changes.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  return commit(state, changes, ranges);
}

function applyWikilink(state: EditorState): Transaction | null {
  const changes: Array<{ from: number; to: number; insert?: string }> = [];
  const ranges: SelectionRange[] = [];
  for (const range of state.selection.ranges) {
    const { from, to } = range;
    if (range.empty) {
      // Insert `[[|]]`, cursor before the closing brackets (ADR-005 form).
      changes.push({ from, to: from, insert: "[[|]]" });
      ranges.push(EditorSelection.cursor(from + 3));
    } else {
      // Selection becomes the link target; cursor lands after the pipe so
      // the user can type the display text next.
      changes.push({ from, to: from, insert: "[[" });
      changes.push({ from: to, to: to, insert: "|]]" });
      ranges.push(EditorSelection.cursor(to + 3));
    }
  }
  changes.sort((a, b) => a.from - b.from);
  return commit(state, changes, ranges);
}

function applyLinePrefix(
  state: EditorState,
  prefix: string,
): Transaction | null {
  const edits: Array<{ from: number; to: number; insert: string }> = [];
  const plannedLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const firstLine = state.doc.lineAt(range.from).number;
    const lastLine = state.doc.lineAt(range.to).number;
    for (let n = firstLine; n <= lastLine; n++) {
      if (plannedLines.has(n)) continue;
      plannedLines.add(n);
      const line = state.doc.line(n);
      edits.push(planPrefix(line.from, line.text, prefix));
    }
  }
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.from - b.from);

  // Selections follow the edits with CM's mapping convention: a range start
  // at an insertion lands after the inserted prefix; a range end before a
  // deletion lands at the deletion point.
  const mapped = state.changes(edits);
  const ranges = state.selection.ranges.map((range) =>
    range.empty
      ? EditorSelection.cursor(mapped.mapPos(range.anchor, 1))
      : EditorSelection.range(
          mapped.mapPos(range.anchor, 1),
          mapped.mapPos(range.head, -1),
        ),
  );
  return commit(
    state,
    edits.map((e) => ({ from: e.from, to: e.to, insert: e.insert })),
    ranges,
  );
}

function planPrefix(
  lineFrom: number,
  lineText: string,
  prefix: string,
): { from: number; to: number; insert: string } {
  // Already exactly this prefix → toggle it off.
  if (lineText.startsWith(prefix)) {
    return { from: lineFrom, to: lineFrom + prefix.length, insert: "" };
  }
  const heading = /^#{1,6}\s+/u.exec(lineText);
  if (heading !== null && prefix.startsWith("#")) {
    // Convert an existing heading level instead of stacking prefixes.
    return { from: lineFrom, to: lineFrom + heading[0].length, insert: prefix };
  }
  // `* ` is a valid markdown bullet too — normalize it to `- ` on toggle.
  if (prefix === "- " && /^[-*]\s/u.test(lineText)) {
    return { from: lineFrom, to: lineFrom + 2, insert: "" };
  }
  return { from: lineFrom, to: lineFrom, insert: prefix };
}

/**
 * Builds the transaction for one toolbar action over the current selection.
 *
 * @returns The transaction to dispatch, or null when there is nothing to do.
 */
export function applyToolbarAction(
  state: EditorState,
  action: ToolbarAction,
): Transaction | null {
  if (action === "wikilink") return applyWikilink(state);
  if (isInline(action)) return applyInline(state, INLINE_MARKERS[action]);
  if (isLine(action)) return applyLinePrefix(state, LINE_PREFIX[action]);
  return null;
}
