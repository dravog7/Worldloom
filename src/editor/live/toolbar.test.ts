import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { applyToolbarAction } from "./toolbar";

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
