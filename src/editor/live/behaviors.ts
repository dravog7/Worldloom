/**
 * W3 — Word-like editing behaviors for the live-preview editor (ADR-005).
 *
 * Pure transaction builders over @codemirror/state. This module deliberately
 * imports NOTHING from @codemirror/view: the keymap is typed structurally
 * (BehaviorView needs only `state` + `dispatch`), so every behavior is
 * unit-testable headless and LiveEditor only needs `keymap.of(
 * createBehaviorKeymap())` — spliced BEFORE indentWithTab so list Tab wins
 * and non-list Tab falls through to code-block indentation.
 *
 * Behaviors (per W3 spec):
 * - Enter: continue a list item (`- `/`* `/`+ `/`N. ` at any indent) with
 *   the same indent + marker style (ordered increments N+1); Enter on an
 *   EMPTY item (prefix only) removes the whole prefix and exits the list;
 *   continue `> ` blockquotes; Enter on a heading opens a plain paragraph;
 *   everything else falls through to CM's default. Inside a code fence
 *   Enter is deliberately unchanged (plain newline) — fence detection is a
 *   pure text heuristic (count ``` / ~~~ lines), not the syntax tree.
 * - Tab / Shift-Tab: indent / outdent a list line by two spaces (outdent
 *   clamps at the indent start, never below 0, only with a list prefix);
 *   NOT in a list → false, falling through to indentWithTab.
 * - Backspace at an inline construct's content start unwraps it (deletes
 *   the opening AND closing markers, keeps content); at a heading line's
 *   content start it demotes one level (h3→h2→h1→paragraph→nothing).
 *
 * Multi-cursor: mutations run through state.changeByRange, so ranges that
 * apply stay consistent. Known gap (per spec): when ANY range can't be
 * handled (plain text, fence, non-empty selection) the helper returns null
 * and the default command runs for every range — no half-handled mixes.
 */
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type Line,
  type Text,
  type Transaction,
} from "@codemirror/state";

/** Parsed list-line prefix. `marker` is "-"| "*"|"+" for bullets, "." for ordered. */
export interface ListPrefix {
  /** Leading whitespace, reused verbatim on continuation. */
  indent: string;
  /** Bullet marker ("-", "*", "+") or the ordered "." after the number. */
  marker: string;
  /** Ordered number (`3.` → 3), null for bullets. */
  num: number | null;
}

/** indent + marker(+number) + one space. */
const LIST_RE = /^([ \t]*)(?:([-*+])|(\d+)([.]))( +)/;
const HEADING_RE = /^(#{1,6})( +)/;
const QUOTE_RE = /^([ \t]*(?:> ?)+)/;
const FENCE_RE = /^[ \t]*(?:`{3,}|~{3,})/;

/**
 * Opening/closing marker pairs of inline constructs, longest/most specific
 * first so `**` wins over `*` and `[[` over `[`.
 */
const INLINE_PAIRS: ReadonlyArray<readonly [open: string, close: string]> = [
  ["[[", "]]"],
  ["**", "**"],
  ["~~", "~~"],
  ["<u>", "</u>"],
  ["*", "*"],
  ["`", "`"],
];

/** Parse the list prefix at the start of a line, or null when there is none. */
export function listPrefixAt(lineText: string): ListPrefix | null {
  const m = LIST_RE.exec(lineText);
  if (m === null) return null;
  return {
    indent: m[1],
    marker: m[2] ?? m[4],
    num: m[3] === undefined ? null : Number(m[3]),
  };
}

/** The prefix a continuation line needs (ordered lists increment). */
function continuationPrefix(prefix: ListPrefix): string {
  const marker =
    prefix.num === null ? prefix.marker : `${prefix.num + 1}${prefix.marker}`;
  return `${prefix.indent}${marker} `;
}

/** Pure fence detection: odd number of ``` / ~~~ lines above → inside. */
function inFence(doc: Text, lineNo: number): boolean {
  let fences = 0;
  for (let n = 1; n < lineNo; n++) {
    if (FENCE_RE.test(doc.line(n).text)) fences++;
  }
  return fences % 2 === 1;
}

type EnterKind =
  | { kind: "plain" }
  | { kind: "fence" }
  | { kind: "heading"; prefixLen: number }
  | { kind: "list"; prefix: ListPrefix; prefixLen: number; empty: boolean }
  | { kind: "quote"; prefix: string };

function enterKind(doc: Text, line: Line): EnterKind {
  if (inFence(doc, line.number)) return { kind: "fence" };
  const heading = HEADING_RE.exec(line.text);
  if (heading !== null) return { kind: "heading", prefixLen: heading[0].length };
  const list = LIST_RE.exec(line.text);
  if (list !== null) {
    return {
      kind: "list",
      prefix: {
        indent: list[1],
        marker: list[2] ?? list[4],
        num: list[3] === undefined ? null : Number(list[3]),
      },
      prefixLen: list[0].length,
      empty: line.text.slice(list[0].length).trim() === "",
    };
  }
  const quote = QUOTE_RE.exec(line.text);
  if (quote !== null) {
    // Normalize to a "> " continuation prefix (keeps nesting, e.g. "> > ").
    return { kind: "quote", prefix: `${quote[1].replace(/[ \t]*$/, "")} ` };
  }
  return { kind: "plain" };
}

/**
 * Enter: list continuation / empty-item exit / ordered increment, quote
 * continuation, heading → paragraph. Null → fall through to the default
 * Enter (plain text and code fences are deliberately unchanged).
 */
export function enterTransaction(state: EditorState): Transaction | null {
  for (const range of state.selection.ranges) {
    if (!range.empty) return null;
  }
  // Any caret we can't handle → default Enter for everyone (documented gap).
  for (const range of state.selection.ranges) {
    const kind = enterKind(state.doc, state.doc.lineAt(range.head));
    if (kind.kind === "plain" || kind.kind === "fence") return null;
  }
  const spec = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    const kind = enterKind(state.doc, line);
    if (kind.kind === "heading") {
      const pos = Math.max(range.head, line.from + kind.prefixLen);
      return { changes: { from: pos, insert: "\n" }, range: EditorSelection.cursor(pos + 1) };
    }
    if (kind.kind === "list") {
      const contentStart = line.from + kind.prefixLen;
      if (kind.empty) {
        // Word rule: Enter on an empty item exits the list — drop the prefix.
        return {
          changes: { from: line.from, to: contentStart } satisfies ChangeSpec,
          range: EditorSelection.cursor(line.from),
        };
      }
      const pos = Math.max(range.head, contentStart);
      const next = continuationPrefix(kind.prefix);
      return {
        changes: { from: pos, insert: `\n${next}` },
        range: EditorSelection.cursor(pos + 1 + next.length),
      };
    }
    if (kind.kind === "quote") {
      const pos = range.head;
      return {
        changes: { from: pos, insert: `\n${kind.prefix}` },
        range: EditorSelection.cursor(pos + 1 + kind.prefix.length),
      };
    }
    return { range }; // unreachable — pre-filtered above
  });
  return state.update(spec);
}

/**
 * Tab / Shift-Tab: indent or outdent a list line by two spaces. Outside a
 * list (including code fences) → null so indentWithTab takes over.
 */
export function tabTransaction(state: EditorState, shift: boolean): Transaction | null {
  for (const range of state.selection.ranges) {
    if (!range.empty) return null;
  }
  const planned = new Set<number>();
  let acted = 0;
  const spec = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    if (planned.has(line.number)) {
      // Second caret on an already-handled line: no change of its own; the
      // accumulated change maps this cursor (changeByRange maps ranges
      // through earlier ranges' changes).
      return { range: EditorSelection.cursor(range.anchor) };
    }
    const prefix = listPrefixAt(line.text);
    if (prefix === null) return { range: EditorSelection.cursor(range.anchor) };
    if (!shift) {
      planned.add(line.number);
      acted++;
      return {
        changes: { from: line.from, insert: "  " },
        range: EditorSelection.cursor(range.anchor + 2),
      };
    }
    const out = Math.min(2, prefix.indent.length);
    if (out === 0) return { range: EditorSelection.cursor(range.anchor) };
    planned.add(line.number);
    acted++;
    return {
      changes: { from: line.from, to: line.from + out } satisfies ChangeSpec,
      range: EditorSelection.cursor(Math.max(line.from, range.anchor - out)),
    };
  });
  if (acted === 0) return null;
  return state.update(spec);
}

/**
 * Backspace: unwrap an inline construct when the caret sits exactly at its
 * content start (deletes opening AND closing markers, keeps the content);
 * demote a heading one level when the caret sits at the content start of
 * the heading line. Null → default backspace.
 */
export function backspaceTransaction(state: EditorState): Transaction | null {
  for (const range of state.selection.ranges) {
    if (!range.empty) return null;
  }
  let acted = 0;
  const spec = state.changeByRange((range) => {
    const line = state.doc.lineAt(range.head);
    const before = line.text.slice(0, range.head - line.from);
    for (const [open, close] of INLINE_PAIRS) {
      if (!before.endsWith(open)) continue;
      const closeStart = line.text.indexOf(close, before.length);
      if (closeStart < 0) continue;
      acted++;
      return {
        changes: [
          { from: range.head - open.length, to: range.head },
          { from: closeStart + line.from, to: closeStart + line.from + close.length },
        ],
        // Caret stays just after whatever preceded the opening marker.
        range: EditorSelection.cursor(range.head - open.length),
      };
    }
    const heading = HEADING_RE.exec(line.text);
    if (heading !== null && range.head === line.from + heading[0].length) {
      acted++;
      if (heading[1].length > 1) {
        // Demote: drop one "#".
        return {
          changes: { from: line.from, to: line.from + 1 } satisfies ChangeSpec,
          range: EditorSelection.cursor(range.anchor - 1),
        };
      }
      // h1 → paragraph: drop "# ".
      return {
        changes: { from: line.from, to: line.from + heading[0].length } satisfies ChangeSpec,
        range: EditorSelection.cursor(range.anchor - heading[0].length),
      };
    }
    return { range: EditorSelection.cursor(range.anchor) };
  });
  if (acted === 0) return null;
  return state.update(spec);
}

/** Minimal view surface our handlers need — keeps this file view-free. */
export interface BehaviorView {
  readonly state: EditorState;
  dispatch: (tr: Transaction) => void;
}

/**
 * Structural stand-in for CM6's KeyBinding: assignable to `keymap.of()`'s
 * input (EditorView satisfies BehaviorView), no @codemirror/view import.
 */
export interface BehaviorBinding {
  key: string;
  run: (view: BehaviorView) => boolean;
}

/**
 * Word-like key bindings in priority order (Enter, Tab, Shift-Tab,
 * Backspace). Each handler dispatches what the matching pure helper
 * returns, or returns false to fall through to the next binding — so this
 * keymap must be registered BEFORE indentWithTab in LiveEditor.
 */
export function createBehaviorKeymap(): BehaviorBinding[] {
  const bind = (
    key: string,
    build: (state: EditorState) => Transaction | null,
  ): BehaviorBinding => ({
    key,
    run: (view) => {
      const tr = build(view.state);
      if (tr === null) return false;
      view.dispatch(tr);
      return true;
    },
  });
  return [
    bind("Enter", enterTransaction),
    bind("Tab", (state) => tabTransaction(state, false)),
    bind("Shift-Tab", (state) => tabTransaction(state, true)),
    bind("Backspace", backspaceTransaction),
  ];
}
