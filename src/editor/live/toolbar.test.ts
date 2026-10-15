import { describe, expect, it } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import {
  applyToolbarAction,
  computeToolbarState,
  type ToolbarState,
} from "./toolbar";

/**
 * ADR-005 toolbar: wraps selections in markdown markers or toggles line
 * prefixes, so users who don't know markdown can still format. Markdown
 * stays the storage bytes — the transaction is pure and testable without
 * a view.
 */

function stateFor(text: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({ doc: text, selection: { anchor, head } });
}

function run(text: string, anchor: number, head: number, action: Parameters<typeof applyToolbarAction>[1]) {
  const tr = applyToolbarAction(stateFor(text, anchor, head), action);
  expect(tr).not.toBeNull();
  return {
    text: tr!.state.doc.toString(),
    anchor: tr!.state.selection.main.anchor,
    head: tr!.state.selection.main.head,
  };
}

describe("applyToolbarAction — inline markers", () => {
  it("bold wraps the selection in ** markers and reselects the text", () => {
    expect(run("hello world", 0, 5, "bold")).toEqual({
      text: "**hello** world",
      anchor: 2,
      head: 7,
    });
  });

  it("bold on an empty selection inserts an empty bold span with the cursor inside", () => {
    expect(run("he llo", 3, 3, "bold")).toEqual({
      text: "he ****llo",
      anchor: 5,
      head: 5,
    });
  });

  it("bold toggles OFF when the selection is already wrapped (**text**)", () => {
    expect(run("**hello** world", 0, 9, "bold")).toEqual({
      text: "hello world",
      anchor: 0,
      head: 5,
    });
  });

  it("bold toggles OFF when the markers sit outside the selection", () => {
    expect(run("**hello** world", 2, 7, "bold")).toEqual({
      text: "hello world",
      anchor: 0,
      head: 5,
    });
  });

  it("italic wraps the selection in * markers and toggles off when wrapped", () => {
    expect(run("say now", 0, 3, "italic")).toEqual({ text: "*say* now", anchor: 1, head: 4 });
    expect(run("*say* now", 0, 5, "italic")).toEqual({ text: "say now", anchor: 0, head: 3 });
  });

  it("code wraps the selection in backticks and toggles off when wrapped", () => {
    expect(run("npm i", 0, 5, "code")).toEqual({ text: "`npm i`", anchor: 1, head: 6 });
    expect(run("`npm i`", 0, 7, "code")).toEqual({ text: "npm i", anchor: 0, head: 5 });
  });

  it("wikilink inserts [[|]] with the cursor before the closing brackets", () => {
    expect(run("", 0, 0, "wikilink")).toEqual({ text: "[[|]]", anchor: 3, head: 3 });
    expect(run("ab", 1, 1, "wikilink")).toEqual({ text: "a[[|]]b", anchor: 4, head: 4 });
  });

  it("wikilink wraps the selection as [[sel|]] with the cursor after the pipe", () => {
    expect(run("Note here", 0, 4, "wikilink")).toEqual({
      text: "[[Note|]] here",
      anchor: 7,
      head: 7,
    });
  });
});

describe("applyToolbarAction — line prefixes", () => {
  it("h1 adds '# ' to the cursor line; toggling again removes it", () => {
    expect(run("Title", 2, 2, "h1")).toEqual({ text: "# Title", anchor: 4, head: 4 });
    expect(run("# Title", 4, 4, "h1")).toEqual({ text: "Title", anchor: 2, head: 2 });
  });

  it("h2 converts an existing h1 line to h2 instead of stacking prefixes", () => {
    expect(run("# Title", 4, 4, "h2")).toEqual({ text: "## Title", anchor: 5, head: 5 });
    expect(run("plain", 0, 0, "h2")).toEqual({ text: "## plain", anchor: 3, head: 3 });
  });

  it("quote toggles the '> ' prefix on and off", () => {
    expect(run("wise words", 0, 0, "quote")).toEqual({ text: "> wise words", anchor: 2, head: 2 });
    expect(run("> wise words", 5, 5, "quote")).toEqual({ text: "wise words", anchor: 3, head: 3 });
  });

  it("bullet inserts '- ' and toggles off for both '- ' and '* ' markers", () => {
    expect(run("item", 0, 0, "bullet")).toEqual({ text: "- item", anchor: 2, head: 2 });
    expect(run("- item", 4, 4, "bullet")).toEqual({ text: "item", anchor: 2, head: 2 });
    expect(run("* item", 4, 4, "bullet")).toEqual({ text: "item", anchor: 2, head: 2 });
  });

  it("a multi-line selection applies the prefix to every line it touches", () => {
    const result = run("one\ntwo\nthree", 0, 9, "bullet");
    expect(result.text).toBe("- one\n- two\n- three");
    expect(result.anchor).toBe(2);
    expect(result.head).toBe(15);
  });

  it("line toggles on a multi-line selection remove the prefix on each line", () => {
    const result = run("- one\n- two", 0, 11, "bullet");
    expect(result.text).toBe("one\ntwo");
  });
});


describe("applyToolbarAction - underline (literal <u> tags)", () => {
  it("underline wraps the selection in <u> tags and reselects the text", () => {
    expect(run("hello world", 0, 5, "underline")).toEqual({
      text: "<u>hello</u> world",
      anchor: 3,
      head: 8,
    });
  });

  it("underline on an empty selection inserts the tag pair with the caret between", () => {
    expect(run("he llo", 3, 3, "underline")).toEqual({
      text: "he <u></u>llo",
      anchor: 6,
      head: 6,
    });
  });

  it("underline toggles OFF when the tags immediately surround the selection", () => {
    expect(run("<u>hello</u> world", 3, 8, "underline")).toEqual({
      text: "hello world",
      anchor: 0,
      head: 5,
    });
  });

  it("underline toggles OFF when the selection contains the tags", () => {
    expect(run("<u>hello</u>", 0, 12, "underline")).toEqual({
      text: "hello",
      anchor: 0,
      head: 5,
    });
  });
});

describe("applyToolbarAction - strikethrough (~~ spans)", () => {
  it("strike wraps the selection in ~~ and reselects the text", () => {
    expect(run("bye world", 0, 3, "strike")).toEqual({
      text: "~~bye~~ world",
      anchor: 2,
      head: 5,
    });
  });

  it("strike toggles OFF when the markers immediately surround the selection", () => {
    expect(run("~~bye~~ world", 2, 5, "strike")).toEqual({
      text: "bye world",
      anchor: 0,
      head: 3,
    });
  });

  it("strike on an empty selection inserts an empty span with the caret inside", () => {
    expect(run("ab", 1, 1, "strike")).toEqual({
      text: "a~~~~b",
      anchor: 3,
      head: 3,
    });
  });
});

describe("applyToolbarAction - h3 and normal", () => {
  it("h3 adds '### ' and converts an existing heading level instead of stacking", () => {
    expect(run("Title", 2, 2, "h3")).toEqual({ text: "### Title", anchor: 6, head: 6 });
    expect(run("# Title", 4, 4, "h3")).toEqual({ text: "### Title", anchor: 6, head: 6 });
  });

  it("normal strips the ATX prefix (paragraph demotion)", () => {
    expect(run("## Title", 5, 5, "normal")).toEqual({ text: "Title", anchor: 2, head: 2 });
    expect(run("# A\n## B", 0, 8, "normal")).toEqual({ text: "A\nB", anchor: 0, head: 3 });
  });

  it("normal on a plain line does nothing (null transaction)", () => {
    expect(applyToolbarAction(stateFor("plain", 2), "normal")).toBeNull();
  });
});

describe("applyToolbarAction - numbered list", () => {
  it("numbered adds '1. ' to a plain line and toggles the ordered marker off", () => {
    expect(run("item", 0, 0, "numbered")).toEqual({ text: "1. item", anchor: 3, head: 3 });
    expect(run("1. item", 5, 5, "numbered")).toEqual({ text: "item", anchor: 2, head: 2 });
  });

  it("numbered converts a bullet line to an ordered one, preserving indent", () => {
    expect(run("- item", 4, 4, "numbered")).toEqual({ text: "1. item", anchor: 5, head: 5 });
    expect(run("  - item", 6, 6, "numbered")).toEqual({ text: "  1. item", anchor: 7, head: 7 });
  });

  it("numbered applies to every line of a multi-line selection", () => {
    expect(run("one\ntwo", 0, 6, "numbered").text).toBe("1. one\n1. two");
  });
});

describe("applyToolbarAction - indent/outdent", () => {
  it("indent adds two spaces to each selected list line", () => {
    expect(run("- one\n- two", 0, 11, "indent")).toEqual({
      text: "  - one\n  - two",
      anchor: 2,
      head: 15,
    });
  });

  it("indent is a no-op outside lists", () => {
    expect(applyToolbarAction(stateFor("plain\nlines", 0, 11), "indent")).toBeNull();
  });

  it("outdent removes up to two leading spaces from a list line", () => {
    expect(run("  - item", 6, 6, "outdent")).toEqual({ text: "- item", anchor: 4, head: 4 });
  });

  it("outdent is a no-op when the list line has no indent", () => {
    expect(applyToolbarAction(stateFor("- item", 2), "outdent")).toBeNull();
  });
});

describe("computeToolbarState - block style", () => {
  it("a plain paragraph reports normal", () => {
    expect(blockOf("just text", 4)).toBe("normal");
  });

  it("h1, h2 and h3 lines report their heading level", () => {
    expect(blockOf("# One", 4)).toBe("h1");
    expect(blockOf("## Two", 5)).toBe("h2");
    expect(blockOf("### Three", 7)).toBe("h3");
  });

  it("deeper headings (h4+) clamp to h3", () => {
    expect(blockOf("#### Four", 6)).toBe("h3");
  });

  it("the caret on the line after a heading reports normal", () => {
    expect(blockOf("# T\nbody", 4)).toBe("normal");
  });
});

describe("computeToolbarState - inline flags", () => {
  it("the caret inside bold content lights the bold flag", () => {
    expect(inlineOf("**hello** world", 4).bold).toBe(true);
  });

  it("both content boundaries count as inside; the markers themselves do not", () => {
    expect(inlineOf("**hello**", 2).bold).toBe(true); // first content char
    expect(inlineOf("**hello**", 7).bold).toBe(true); // last content edge
    expect(inlineOf("**hello**", 1).bold).toBe(false); // inside opening **
    expect(inlineOf("**hello**", 9).bold).toBe(false); // inside closing **
  });

  it("the caret inside italic lights the italic flag", () => {
    expect(inlineOf("*soft* now", 3).italic).toBe(true);
    expect(inlineOf("*soft* now", 9).italic).toBe(false);
  });

  it("the caret inside inline code lights the code flag", () => {
    expect(inlineOf("`npm i` now", 4).code).toBe(true);
    expect(inlineOf("`npm i` now", 0).code).toBe(false);
  });

  it("the caret inside <u> content lights underline; the tags themselves do not", () => {
    expect(inlineOf("say <u>under</u> x", 9).underline).toBe(true);
    expect(inlineOf("say <u>under</u> x", 7).underline).toBe(true); // boundary
    expect(inlineOf("say <u>under</u> x", 5).underline).toBe(false); // inside <u>
    expect(inlineOf("say <u>under</u> x", 14).underline).toBe(false); // inside </u>
  });

  it("the caret inside ~~ content lights strike", () => {
    expect(inlineOf("~~gone~~ x", 4).strike).toBe(true);
    expect(inlineOf("~~gone~~ x", 1).strike).toBe(false);
  });

  it("nested constructs report every enclosing flag", () => {
    const flags = inlineOf("**bold *ital* x**", 10);
    expect(flags.bold).toBe(true);
    expect(flags.italic).toBe(true);
  });
});

function blockOf(text: string, pos: number): ToolbarState["block"] {
  return computeToolbarState(Text.of(text.split("\n")), pos).block;
}

function inlineOf(text: string, pos: number): ToolbarState["inline"] {
  return computeToolbarState(Text.of(text.split("\n")), pos).inline;
}
