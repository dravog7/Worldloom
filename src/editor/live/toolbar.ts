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
 * W2 word-style toolbar: literal `<u>`/`~~` toggles, ordered lists, list
 * indent/outdent, and `computeToolbarState` — a pure caret reflection of
 * the block style + inline flags for the toolbar UI.
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
  type Text,
  type Transaction,
} from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";

export type ToolbarAction =
  | "bold"
  | "italic"
  | "h1"
  | "h2"
  | "quote"
  | "bullet"
  | "wikilink"
  | "code"
  | "h3"
  | "underline"
  | "strike"
  | "numbered"
  | "indent"
  | "outdent"
  | "normal";

type InlineAction = "bold" | "italic" | "code" | "underline" | "strike";

const INLINE_MARKERS: Record<InlineAction, { open: string; close: string }> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  code: { open: "`", close: "`" },
  underline: { open: "<u>", close: "</u>" },
  strike: { open: "~~", close: "~~" },
};

const LINE_ACTIONS = ["h1", "h2", "h3", "quote", "bullet"] as const;
type LineAction = (typeof LINE_ACTIONS)[number];

const LINE_PREFIX: Record<LineAction, string> = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
  quote: "> ",
  bullet: "- ",
};

function isInline(action: ToolbarAction): action is InlineAction {
  return (
    action === "bold" ||
    action === "italic" ||
    action === "code" ||
    action === "underline" ||
    action === "strike"
  );
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

function applyLineEdits(
  state: EditorState,
  plan: (
    lineFrom: number,
    lineText: string,
  ) => { from: number; to: number; insert: string } | null,
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
      const edit = plan(line.from, line.text);
      if (edit) edits.push(edit);
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

function applyLinePrefix(
  state: EditorState,
  prefix: string,
): Transaction | null {
  return applyLineEdits(state, (lineFrom, lineText) =>
    planPrefix(lineFrom, lineText, prefix),
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

/** Ordered-list marker: optional indent, digits, dot, space. */
const ORDERED_ITEM = /^(\s*)(\d+)\.\s/u;
/** Any list line — bullet (`- `/`* `) or ordered (`1. `) — with optional indent. */
const LIST_ITEM = /^(\s*)(?:[-*]|\d+\.)\s/u;

function planNumbered(
  lineFrom: number,
  lineText: string,
): { from: number; to: number; insert: string } {
  const ordered = ORDERED_ITEM.exec(lineText);
  if (ordered !== null) {
    // Already ordered → toggle the marker off, keeping the indent.
    return {
      from: lineFrom + ordered[1].length,
      to: lineFrom + ordered[0].length,
      insert: "",
    };
  }
  const indent = /^(\s*)/u.exec(lineText)?.[1] ?? "";
  const after = lineFrom + indent.length;
  // A bullet line converts to ordered instead of stacking a second marker.
  const bullet = /^[-*]\s/u.test(lineText.slice(indent.length));
  return { from: after, to: bullet ? after + 2 : after, insert: "1. " };
}

function planNormal(
  lineFrom: number,
  lineText: string,
): { from: number; to: number; insert: string } | null {
  const heading = /^#{1,6}\s+/u.exec(lineText);
  if (heading === null) return null; // already a paragraph
  return { from: lineFrom, to: lineFrom + heading[0].length, insert: "" };
}

function planIndent(
  _lineFrom: number,
  lineText: string,
): { from: number; to: number; insert: string } | null {
  if (!LIST_ITEM.test(lineText)) return null; // indent only inside lists
  return { from: _lineFrom, to: _lineFrom, insert: "  " };
}

function planOutdent(
  lineFrom: number,
  lineText: string,
): { from: number; to: number; insert: string } | null {
  if (!LIST_ITEM.test(lineText)) return null;
  const spaces = /^ */u.exec(lineText)?.[0].length ?? 0;
  if (spaces === 0) return null;
  return { from: lineFrom, to: lineFrom + Math.min(2, spaces), insert: "" };
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
  if (action === "normal") return applyLineEdits(state, planNormal);
  if (action === "numbered") return applyLineEdits(state, planNumbered);
  if (action === "indent") return applyLineEdits(state, planIndent);
  if (action === "outdent") return applyLineEdits(state, planOutdent);
  return null;
}

/**
 * Block style for the style dropdown (frozen W2 contract).
 */
export type BlockStyle = "normal" | "h1" | "h2" | "h3";

/**
 * Toolbar reflection of the caret's context (frozen W2 contract): the
 * block dropdown value plus the inline-toggle flags.
 */
export interface ToolbarState {
  block: BlockStyle;
  inline: {
    bold: boolean;
    italic: boolean;
    strike: boolean;
    code: boolean;
    underline: boolean;
  };
}

const ATX_LEVEL = /^ATXHeading([1-6])$/u;

/**
 * Content span of an emphasis node, mirroring the decoration rules: only
 * the exact `*…*` / `**…**` delimiter runs count (decorations.ts `inline`).
 */
function emphasisContent(
  doc: Text,
  node: SyntaxNode,
  marker: string,
): [number, number] | null {
  const first = node.firstChild;
  const last = node.lastChild;
  if (!first || !last || first === last) return null;
  // @lezer/markdown names both `*`/`**` delimiter runs EmphasisMark.
  if (first.name !== "EmphasisMark" || last.name !== "EmphasisMark") return null;
  if (doc.sliceString(first.from, first.to) !== marker) return null;
  if (doc.sliceString(last.from, last.to) !== marker) return null;
  return [first.to, last.from];
}

/** Content span of a single-backtick InlineCode node (decorations rules). */
function inlineCodeContent(node: SyntaxNode): [number, number] | null {
  const first = node.firstChild;
  const last = node.lastChild;
  if (!first || !last || first === last) return null;
  if (first.name !== "CodeMark" || last.name !== "CodeMark") return null;
  if (first.to - node.from !== 1 || node.to - last.from !== 1) return null;
  return [first.to, last.from];
}

/**
 * Whether `pos` lies inside — or on either boundary of — the CONTENT of a
 * literal `open…close` span (`~~…~~`, `<u>…</u>`). The markdown parser has
 * no nodes for these, so they are located textually, pairing open/close
 * runs left to right (symmetric delimiters alternate open/close).
 */
function insideLiteralSpan(
  text: string,
  pos: number,
  open: string,
  close: string,
): boolean {
  if (open === close) {
    let spanOpen = -1;
    for (
      let i = text.indexOf(open);
      i !== -1;
      i = text.indexOf(open, i + open.length)
    ) {
      if (spanOpen === -1) spanOpen = i;
      else {
        if (pos >= spanOpen + open.length && pos <= i) return true;
        spanOpen = -1;
      }
    }
    return false;
  }
  let depth = 0;
  let spanOpen = -1;
  let i = 0;
  for (;;) {
    const nextOpen = text.indexOf(open, i);
    const nextClose = text.indexOf(close, i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      if (depth === 0) spanOpen = nextOpen;
      depth += 1;
      i = nextOpen + open.length;
      continue;
    }
    depth -= 1;
    if (depth === 0 && spanOpen !== -1) {
      if (pos >= spanOpen + open.length && pos <= nextClose) return true;
      spanOpen = -1;
    }
    i = nextClose + close.length;
  }
  return false;
}

/**
 * Toolbar state for a caret at `pos` (frozen W2 contract). Pure over the
 * document — the markdown tree is parsed here, exactly as decorations do
 * it at compute time.
 *
 * - block: heading level of the caret's line (h4+ clamp to h3, none -> normal);
 * - inline: true iff `pos` sits inside — or on the boundary of — the
 *   construct's CONTENT range (same edges the reveal rule uses), with the
 *   literal `~~`/`<u>` spans found textually since the parser has no nodes.
 */
export function computeToolbarState(doc: Text, pos: number): ToolbarState {
  const text = doc.toString();
  const line = doc.lineAt(pos);
  const result: ToolbarState = {
    block: "normal",
    inline: {
      bold: false,
      italic: false,
      strike: false,
      code: false,
      underline: false,
    },
  };
  const inside = (span: [number, number] | null): boolean =>
    span !== null && pos >= span[0] && pos <= span[1];

  markdownLanguage.parser.parse(text).iterate({
    enter(nodeRef) {
      const node = nodeRef.node;
      const atx = ATX_LEVEL.exec(node.name);
      if (atx !== null) {
        if (doc.lineAt(node.from).number === line.number) {
          const level = Number(atx[1]);
          result.block = level === 1 ? "h1" : level === 2 ? "h2" : "h3";
        }
        return;
      }
      if (node.name === "SetextHeading1" || node.name === "SetextHeading2") {
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        if (line.number >= first && line.number <= last) {
          result.block = node.name === "SetextHeading1" ? "h1" : "h2";
        }
        return;
      }
      if (
        node.name === "StrongEmphasis" &&
        inside(emphasisContent(doc, node, "**"))
      ) {
        result.inline.bold = true;
      } else if (
        node.name === "Emphasis" &&
        inside(emphasisContent(doc, node, "*"))
      ) {
        result.inline.italic = true;
      } else if (
        node.name === "InlineCode" &&
        inside(inlineCodeContent(node))
      ) {
        result.inline.code = true;
      }
    },
  });
  result.inline.underline = insideLiteralSpan(text, pos, "<u>", "</u>");
  result.inline.strike = insideLiteralSpan(text, pos, "~~", "~~");
  return result;
}
