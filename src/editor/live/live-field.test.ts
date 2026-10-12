/**
 * M1.1 assembly smoke (I3): the LiveEditor's decoration StateField must
 * compute real decorations inside a genuine EditorState (language extension
 * mounted) and recompute on doc/selection transactions — the exact code path
 * LiveEditor.tsx wires, exercised headless (no DOM/EditorView).
 */
import { EditorState } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { describe, expect, it } from "vitest";
import { liveDecorations } from "./LiveEditor";

const DOC = "# The Exile\n\nAelindra slipped into [[Vael'Thor]] with **bold** intent.\n\n> A quote.\n";

function makeState(): EditorState {
  return EditorState.create({
    doc: DOC,
    extensions: [markdownLanguage, liveDecorations],
  });
}

describe("liveDecorations field inside a real EditorState", () => {
  it("computes decorations at construction", () => {
    expect(makeState().field(liveDecorations).size).toBeGreaterThan(0);
  });

  it("recomputes on document changes without throwing", () => {
    const state = makeState();
    const tr = state.update({ changes: { from: 0, to: 0, insert: "Note: " } });
    expect(tr.state.field(liveDecorations).size).toBeGreaterThan(0);
  });

  it("recomputes on selection moves without throwing", () => {
    const state = makeState();
    const tr = state.update({ selection: { anchor: 3 } }); // caret inside the H1 heading → that heading reveals
    const before = state.field(liveDecorations).size;
    const after = tr.state.field(liveDecorations).size;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(before + 5); // stable magnitude, no runaway growth
  });

  it("handles an empty document", () => {
    const state = EditorState.create({ doc: "", extensions: [markdownLanguage, liveDecorations] });
    expect(state.field(liveDecorations).size).toBe(0);
  });
});
