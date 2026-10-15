/**
 * W3 — Word-like editing behaviors (ADR-005 live preview). Each behavior is
 * a pure transaction builder over @codemirror/state; the exported keymap
 * wraps them so LiveEditor can splice it in before indentWithTab (list Tab
 * wins, everything else falls through by returning false).
 *
 * Documented expected behaviors:
 * - Enter inside a code fence is deliberately UNCHANGED: the helper returns
 *   null and CM's default insertNewlineAndIndent inserts a plain newline
 *   (no list/quote continuation inside fences; fence detection is the pure
 *   text heuristic of counting ```/~~~ lines, not a syntax tree).
 * - Multi-cursor: when any caret falls in a construct the helper can't
 *   handle (plain text, fence, non-empty selection), the WHOLE helper
 *   returns null and the default command runs for every caret — no
 *   half-handled multi-cursor transactions.
 * - Multi-cursor test states need EditorState.allowMultipleSelections.of(
 *   true): CM6 silently collapses extra ranges to the main one without it
 *   (LiveEditor does not enable it; the helpers support multi-cursor
 *   regardless and the tests pin that behavior).
 */
import { describe, expect, it } from "vitest";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
  backspaceTransaction,
  createBehaviorKeymap,
  enterTransaction,
  listPrefixAt,
  tabTransaction,
} from "./behaviors";

/** Build a state; "|" marks the caret (first = anchor, second = head). */
function mk(text: string): EditorState {
  let doc = "";
  const marks: number[] = [];
  for (const ch of text) {
    if (ch === "|") marks.push(doc.length);
    else doc += ch;
  }
  const [anchor = 0, head = anchor] = marks;
  return EditorState.create({ doc, selection: { anchor, head } });
}

/** Parse an expected string the same way ("|" = caret position). */
function parse(text: string): { doc: string; cursor: number } {
  let doc = "";
  const marks: number[] = [];
  for (const ch of text) {
    if (ch === "|") marks.push(doc.length);
    else doc += ch;
  }
  return { doc, cursor: marks[0] ?? doc.length };
}

function outcome(tr: Transaction | null): { doc: string; cursor: number } | null {
  if (!tr) return null;
  return { doc: tr.state.doc.toString(), cursor: tr.state.selection.main.head };
}

describe("listPrefixAt", () => {
  it("parses every bullet style with its indent", () => {
    expect(listPrefixAt("- item")).toEqual({ indent: "", marker: "-", num: null });
    expect(listPrefixAt("* item")).toEqual({ indent: "", marker: "*", num: null });
    expect(listPrefixAt("+ item")).toEqual({ indent: "", marker: "+", num: null });
    expect(listPrefixAt("  - nested")).toEqual({ indent: "  ", marker: "-", num: null });
    expect(listPrefixAt("\t* tabbed")).toEqual({ indent: "\t", marker: "*", num: null });
  });

  it("parses ordered markers, keeping the number", () => {
    expect(listPrefixAt("1. one")).toEqual({ indent: "", marker: ".", num: 1 });
    expect(listPrefixAt("10. ten")).toEqual({ indent: "", marker: ".", num: 10 });
    expect(listPrefixAt("  2. nested")).toEqual({ indent: "  ", marker: ".", num: 2 });
  });

  it("rejects non-list lines", () => {
    expect(listPrefixAt("plain")).toBeNull();
    expect(listPrefixAt("# heading")).toBeNull();
    expect(listPrefixAt("-nospace")).toBeNull();
    expect(listPrefixAt("1.nospace")).toBeNull();
  });
});

describe("enterTransaction", () => {
  it("continues a bullet item with the same marker and indent", () => {
    expect(outcome(enterTransaction(mk("- alpha|")))).toEqual(parse("- alpha\n- |"));
  });

  it("keeps each bullet style verbatim", () => {
    expect(outcome(enterTransaction(mk("* a|")))).toEqual(parse("* a\n* |"));
    expect(outcome(enterTransaction(mk("+ a|")))).toEqual(parse("+ a\n+ |"));
  });

  it("preserves nested indent depth", () => {
    expect(outcome(enterTransaction(mk("  - deep|")))).toEqual(parse("  - deep\n  - |"));
  });

  it("increments ordered markers, including 9→10 and 99→100", () => {
    expect(outcome(enterTransaction(mk("1. one|")))).toEqual(parse("1. one\n2. |"));
    expect(outcome(enterTransaction(mk("9. nine|")))).toEqual(parse("9. nine\n10. |"));
    expect(outcome(enterTransaction(mk("99. x|")))).toEqual(parse("99. x\n100. |"));
  });

  it("exits a bullet list when Enter lands on an empty item", () => {
    expect(outcome(enterTransaction(mk("- |")))).toEqual(parse("|"));
  });

  it("exits an ordered list when Enter lands on an empty item", () => {
    expect(outcome(enterTransaction(mk("3. |")))).toEqual(parse("|"));
  });

  it("exits a nested empty item, removing indent and prefix entirely", () => {
    expect(outcome(enterTransaction(mk("- a\n  - |")))).toEqual(parse("- a\n|"));
  });

  it("splits a list item mid-content", () => {
    expect(outcome(enterTransaction(mk("- al|pha")))).toEqual(parse("- al\n- |pha"));
  });

  it("continues a blockquote", () => {
    expect(outcome(enterTransaction(mk("> said|")))).toEqual(parse("> said\n> |"));
    expect(outcome(enterTransaction(mk("> a|b")))).toEqual(parse("> a\n> |b"));
  });

  it("turns Enter on a heading into a plain paragraph", () => {
    expect(outcome(enterTransaction(mk("## Title|")))).toEqual(parse("## Title\n|"));
  });

  it("splits a heading mid-text without re-prefixing the new line", () => {
    expect(outcome(enterTransaction(mk("## Ti|tle")))).toEqual(parse("## Ti\n|tle"));
  });

  it("falls through to the default Enter outside constructs", () => {
    expect(enterTransaction(mk("plain|"))).toBeNull();
    expect(enterTransaction(mk("- a\nplain|"))).toBeNull();
  });

  it("keeps Enter unchanged inside a code fence (plain newline)", () => {
    expect(enterTransaction(mk("```\n- item|"))).toBeNull();
    expect(enterTransaction(mk("```js\nconst x = 1;|"))).toBeNull();
  });

  it("continues each caret's own list line (multi-cursor)", () => {
    const state = EditorState.create({
      doc: "- one\n- two",
      selection: EditorSelection.create(
        [EditorSelection.cursor(5), EditorSelection.cursor(11)],
        0,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    expect(outcome(enterTransaction(state))).toEqual({
      doc: "- one\n- \n- two\n- ",
      cursor: 8,
    });
  });
});

describe("tabTransaction", () => {
  it("indents a list line by two spaces", () => {
    expect(outcome(tabTransaction(mk("- item|"), false))).toEqual(parse("  - item|"));
  });

  it("indents ordered and nested lines too", () => {
    expect(outcome(tabTransaction(mk("1. x|"), false))).toEqual(parse("  1. x|"));
    expect(outcome(tabTransaction(mk("  - x|"), false))).toEqual(parse("    - x|"));
  });

  it("falls through outside lists (code blocks keep indentWithTab)", () => {
    expect(tabTransaction(mk("code|x"), false)).toBeNull();
    expect(tabTransaction(mk("```\nconst x| = 1;"), false)).toBeNull();
  });

  it("outdents by two, clamps at a one-space indent, stops at zero", () => {
    expect(outcome(tabTransaction(mk("    - x|"), true))).toEqual(parse("  - x|"));
    expect(outcome(tabTransaction(mk(" - x|"), true))).toEqual(parse("- x|"));
    expect(tabTransaction(mk("- x|"), true)).toBeNull();
  });

  it("outdents only lines with a list prefix", () => {
    expect(tabTransaction(mk("plain|"), true)).toBeNull();
    expect(tabTransaction(mk("    plain|"), true)).toBeNull();
  });

  it("indents a line once for two carets on it (multi-cursor, same line)", () => {
    const state = EditorState.create({
      doc: "- one",
      selection: EditorSelection.create(
        [EditorSelection.cursor(2), EditorSelection.cursor(4)],
        0,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    expect(outcome(tabTransaction(state, false))).toEqual({
      doc: "  - one",
      cursor: 4,
    });
  });

  it("indents each caret's own line (multi-cursor, different lines)", () => {
    const state = EditorState.create({
      doc: "- one\n- two",
      selection: EditorSelection.create(
        [EditorSelection.cursor(3), EditorSelection.cursor(9)],
        0,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    expect(outcome(tabTransaction(state, false))).toEqual({
      doc: "  - one\n  - two",
      cursor: 5,
    });
  });
});

describe("backspaceTransaction", () => {
  it("unwraps bold markers, keeping the content", () => {
    expect(outcome(backspaceTransaction(mk("**|bold**")))).toEqual(parse("|bold"));
  });

  it("unwraps italic, leaving the caret after the preceding content", () => {
    expect(outcome(backspaceTransaction(mk("say *|hi* now")))).toEqual(parse("say |hi now"));
  });

  it("unwraps inline code", () => {
    expect(outcome(backspaceTransaction(mk("`|code`")))).toEqual(parse("|code"));
  });

  it("unwraps strikethrough", () => {
    expect(outcome(backspaceTransaction(mk("~~|gone~~")))).toEqual(parse("|gone"));
  });

  it("unwraps underline tags", () => {
    expect(outcome(backspaceTransaction(mk("<u>|word</u>")))).toEqual(parse("|word"));
  });

  it("unwraps a wikilink", () => {
    expect(outcome(backspaceTransaction(mk("[[|Page]]")))).toEqual(parse("|Page"));
  });

  it("unwraps a wikilink with display text, keeping both parts", () => {
    const state = EditorState.create({
      doc: "[[Page|Title]]",
      selection: { anchor: 2 },
    });
    expect(outcome(backspaceTransaction(state))).toEqual({
      doc: "Page|Title",
      cursor: 0,
    });
  });

  it("does not unwrap when the selection is not empty", () => {
    const state = EditorState.create({
      doc: "**bold**",
      selection: EditorSelection.range(2, 6),
    });
    expect(backspaceTransaction(state)).toBeNull();
  });

  it("does not unwrap when no closing marker exists on the line", () => {
    expect(backspaceTransaction(mk("**bo|ld"))).toBeNull();
  });

  it("unwraps progressively through three-star markers", () => {
    expect(outcome(backspaceTransaction(mk("***|x***")))).toEqual(parse("*|x*"));
  });

  it("demotes a heading one level", () => {
    expect(outcome(backspaceTransaction(mk("### |Title")))).toEqual(parse("## |Title"));
  });

  it("turns h1 into a paragraph", () => {
    expect(outcome(backspaceTransaction(mk("# |Title")))).toEqual(parse("|Title"));
  });

  it("runs the full demote chain to a paragraph, then stops", () => {
    let tr = backspaceTransaction(mk("### |x"));
    expect(outcome(tr)).toEqual(parse("## |x"));
    tr = tr && backspaceTransaction(tr.state);
    expect(outcome(tr)).toEqual(parse("# |x"));
    tr = tr && backspaceTransaction(tr.state);
    expect(outcome(tr)).toEqual(parse("|x"));
    expect(tr && backspaceTransaction(tr.state)).toBeFalsy();
  });

  it("does not demote when the caret is not at heading content start", () => {
    expect(backspaceTransaction(mk("## T|itle"))).toBeNull();
  });

  it("plain backspace falls through untouched", () => {
    expect(backspaceTransaction(mk("ab|c"))).toBeNull();
    expect(backspaceTransaction(mk("|intro"))).toBeNull();
  });

  it("unwraps at every caret (multi-cursor)", () => {
    const state = EditorState.create({
      doc: "**one** and **two**",
      selection: EditorSelection.create(
        [EditorSelection.cursor(2), EditorSelection.cursor(14)],
        0,
      ),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    });
    expect(outcome(backspaceTransaction(state))).toEqual({
      doc: "one and two",
      cursor: 0,
    });
  });
});

describe("createBehaviorKeymap", () => {
  it("binds Enter, Tab, Shift-Tab, Backspace in that order", () => {
    expect(createBehaviorKeymap().map((binding) => binding.key)).toEqual([
      "Enter",
      "Tab",
      "Shift-Tab",
      "Backspace",
    ]);
  });

  it("dispatches the helper's transaction and reports handled", () => {
    const seen: Transaction[] = [];
    const handled = createBehaviorKeymap()[0].run({
      state: mk("- item|"),
      dispatch: (tr) => {
        seen.push(tr);
      },
    });
    expect(handled).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].state.doc.toString()).toBe("- item\n- ");
  });

  it("returns false without dispatching when the helper has nothing to do", () => {
    let dispatched = 0;
    const handled = createBehaviorKeymap()[0].run({
      state: mk("plain|"),
      dispatch: () => {
        dispatched++;
      },
    });
    expect(handled).toBe(false);
    expect(dispatched).toBe(0);
  });

  it("is accepted by CM6's keymap.of (integration type check)", () => {
    expect(() => keymap.of(createBehaviorKeymap())).not.toThrow();
  });
});
