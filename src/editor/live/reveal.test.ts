import { describe, expect, it } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { isConstructRevealed } from "./reveal";

/**
 * Construct-scoped reveal rule (docs/DISCOVERY-editor-models.md §3–§4):
 * raw markdown is visible only for the construct(s) the caret is actually
 * inside — never for a merely-selected region (Word-like feel; no reference
 * editor reveals syntax for a selection, §1 synthesis). A selection is the
 * one exception only when it *partially cuts* a construct (an endpoint in
 * the strict interior): then that construct reveals, which is the §4.2.4
 * cursor-jump guard — a hidden marker the selection straddles must show.
 *
 * The predicate is pure arithmetic over document positions so the whole
 * decoration engine stays unit-testable headless (no DOM, no view).
 */

const SPAN: [number, number] = [4, 12]; // e.g. `**loud**` in "say **loud** now"

describe("isConstructRevealed — caret (empty range)", () => {
  it("a caret inside a construct reveals it", () => {
    expect(isConstructRevealed(...SPAN, [EditorSelection.cursor(8)])).toBe(true);
  });

  it("a caret at either edge of a construct reveals it (inclusive — typing at a construct's end keeps its markers visible)", () => {
    expect(isConstructRevealed(...SPAN, [EditorSelection.cursor(4)])).toBe(true);
    expect(isConstructRevealed(...SPAN, [EditorSelection.cursor(12)])).toBe(true);
  });

  it("a caret outside a construct reveals nothing", () => {
    expect(isConstructRevealed(...SPAN, [EditorSelection.cursor(3)])).toBe(false);
    expect(isConstructRevealed(...SPAN, [EditorSelection.cursor(13)])).toBe(false);
  });

  it("a caret at document position 0 reveals a construct starting at 0", () => {
    expect(isConstructRevealed(0, 5, [EditorSelection.cursor(0)])).toBe(true);
  });
});

describe("isConstructRevealed — selection (non-empty range)", () => {
  it("a selection fully containing a construct reveals nothing", () => {
    expect(isConstructRevealed(...SPAN, [EditorSelection.range(0, 20)])).toBe(false);
    expect(isConstructRevealed(...SPAN, [EditorSelection.range(4, 12)])).toBe(false);
  });

  it("a selection fully inside a construct reveals nothing", () => {
    expect(isConstructRevealed(...SPAN, [EditorSelection.range(6, 10)])).toBe(false);
  });

  it("a selection partially cutting a construct (head strictly inside) reveals it", () => {
    expect(isConstructRevealed(...SPAN, [EditorSelection.range(8, 14)])).toBe(true);
  });

  it("a selection partially cutting a construct (tail strictly inside) reveals it", () => {
    expect(isConstructRevealed(...SPAN, [EditorSelection.range(2, 8)])).toBe(true);
  });

  it("a selection ending exactly at a construct edge does not cut it", () => {
    expect(isConstructRevealed(...SPAN, [EditorSelection.range(2, 4)])).toBe(false);
    expect(isConstructRevealed(...SPAN, [EditorSelection.range(12, 20)])).toBe(false);
  });
});

describe("isConstructRevealed — multiple ranges (multi-cursor)", () => {
  it("any single revealing range wins (OR over all ranges)", () => {
    const ranges = [
      EditorSelection.range(0, 20), // fully containing — reveals nothing
      EditorSelection.cursor(8), // caret inside — reveals
    ];
    expect(isConstructRevealed(...SPAN, ranges)).toBe(true);
  });

  it("no range touching the construct means no reveal", () => {
    const ranges = [
      EditorSelection.range(0, 2),
      EditorSelection.range(20, 24),
      EditorSelection.cursor(100),
    ];
    expect(isConstructRevealed(...SPAN, ranges)).toBe(false);
  });

  it("an empty selection list reveals nothing", () => {
    expect(isConstructRevealed(...SPAN, [])).toBe(false);
  });
});

describe("isConstructRevealed — degenerate constructs", () => {
  it("a zero-width construct reveals only for a caret exactly at it", () => {
    expect(isConstructRevealed(5, 5, [EditorSelection.cursor(5)])).toBe(true);
    expect(isConstructRevealed(5, 5, [EditorSelection.cursor(4)])).toBe(false);
    // A selection straddling a zero-width span has no endpoint strictly
    // inside it — nothing to partially cut.
    expect(isConstructRevealed(5, 5, [EditorSelection.range(2, 8)])).toBe(false);
  });

  it("an inverted span (to < from) reveals nothing", () => {
    expect(isConstructRevealed(12, 4, [EditorSelection.cursor(8)])).toBe(false);
    expect(isConstructRevealed(12, 4, [EditorSelection.range(8, 20)])).toBe(false);
  });
});
