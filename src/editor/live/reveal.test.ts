import { describe, expect, it } from "vitest";
import { EditorSelection, Text } from "@codemirror/state";
import { revealLines } from "./reveal";

/**
 * M1.2 interim reveal rule (CTO: "live mode should feel like MS Word;
 * don't switch to markdown for a selected portion"): a selection reveals
 * nothing; only a caret reveals raw syntax, and only its own line.
 */

function doc(text: string): Text {
  return Text.of(text.split("\n"));
}

describe("revealLines", () => {
  it("a caret reveals exactly its own line — no neighbours", () => {
    const d = doc("one\ntwo\nthree\nfour");
    expect([...revealLines([EditorSelection.cursor(5)], d)]).toEqual([2]);
  });

  it("a caret at the document edges clamps to the existing line", () => {
    const d = doc("only\nsecond");
    expect([...revealLines([EditorSelection.cursor(0)], d)]).toEqual([1]);
    expect([...revealLines([EditorSelection.cursor(d.length)], d)]).toEqual([2]);
  });

  it("a non-empty selection reveals NOTHING (Word-like)", () => {
    const d = doc("one\ntwo\nthree\nfour");
    const spanning = EditorSelection.range(2, 11); // part of line 1 through line 3
    expect([...revealLines([spanning], d)]).toEqual([]);
    const tight = EditorSelection.range(0, 3); // stays inside line 1
    expect([...revealLines([tight], d)]).toEqual([]);
  });

  it("mixed caret + selection: only the caret's line reveals", () => {
    const d = doc("one\ntwo\nthree\nfour\nfive");
    const ranges = [
      EditorSelection.cursor(0), // caret on line 1
      EditorSelection.range(15, 17), // selection inside line 4
    ];
    expect([...revealLines(ranges, d)]).toEqual([1]);
  });

  it("multiple carets union their lines", () => {
    const d = doc("one\ntwo\nthree\nfour\nfive");
    const ranges = [
      EditorSelection.cursor(1), // line 1
      EditorSelection.cursor(16), // line 4
    ];
    expect([...revealLines(ranges, d)].sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it("an empty document yields the single line", () => {
    expect([...revealLines([EditorSelection.cursor(0)], doc(""))]).toEqual([1]);
  });
});
