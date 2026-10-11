import { describe, expect, it } from "vitest";
import { EditorSelection, Text } from "@codemirror/state";
import { revealLines } from "./reveal";

/**
 * ADR-005 reveal rule: raw syntax is visible on the lines a selection
 * touches. A caret additionally reveals its immediate neighbour lines
 * (head line ± 1) so constructs straddling the cursor line's edges stay
 * legible while typing; an explicit selection is precise intent, so it
 * reveals exactly the lines it spans.
 */

function doc(text: string): Text {
  return Text.of(text.split("\n"));
}

describe("revealLines", () => {
  it("a caret reveals its own line plus the lines immediately above and below", () => {
    const d = doc("one\ntwo\nthree\nfour");
    expect([...revealLines([EditorSelection.cursor(5)], d)].sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
  });

  it("a caret at the document edges clamps to existing lines", () => {
    const d = doc("only\nsecond");
    expect([...revealLines([EditorSelection.cursor(0)], d)].sort((a, b) => a - b)).toEqual([1, 2]);
    expect([...revealLines([EditorSelection.cursor(d.length)], d)].sort((a, b) => a - b)).toEqual([
      1, 2,
    ]);
  });

  it("a non-empty selection reveals every line it spans, without neighbours", () => {
    const d = doc("one\ntwo\nthree\nfour");
    const range = EditorSelection.range(2, 11); // part of line 1 through line 3
    expect([...revealLines([range], d)].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    const tight = EditorSelection.range(0, 3); // stays inside line 1
    expect([...revealLines([tight], d)]).toEqual([1]);
  });

  it("multiple cursors and selections union their touched lines", () => {
    const d = doc("one\ntwo\nthree\nfour\nfive");
    const ranges = [
      EditorSelection.cursor(0), // lines 1-2
      EditorSelection.range(15, 17), // inside line 4
    ];
    expect([...revealLines(ranges, d)].sort((a, b) => a - b)).toEqual([1, 2, 4]);
  });

  it("an empty document yields the single line", () => {
    expect([...revealLines([EditorSelection.cursor(0)], doc(""))]).toEqual([1]);
  });
});
