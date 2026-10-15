// @vitest-environment jsdom
/**
 * HOME-KEY BUG regression (e2e diag DIAG-B2): in the live view (lineWrapping
 * on) CM6's Home/End resolve their target through `posAtCoords` at the
 * editor's extreme left/right edge. Chromium's native hit-testing — which
 * the click-map override routes every posAtCoords call through — resolves
 * points in the scroller's padding region to the `.cm-scroller` element
 * itself, and `posAtDOM(scroller, 0)` maps to document position 0, so Home
 * (and Shift+Home, and End) jumped to the document start.
 *
 * These tests reproduce that exact call sequence headlessly against a REAL
 * EditorView: the production override is installed, and
 * `document.caretPositionFromPoint` is stubbed with what Chromium actually
 * returns at the Home probe point (verified in real chromium: the
 * `.cm-scroller` element, offset 0 — see src/editor/live/click-map.ts).
 *
 * jsdom has no layout, so CM6's measurement needs Range rects; a zero rect
 * keeps the measure pipeline alive without pretending any geometry.
 */
import { EditorSelection, EditorState, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeDecorations } from "./decorations";
import { installNativeClickMapping } from "./click-map";

/* Zero-rect measurement shims — enough for CM6's measure pipeline in jsdom. */
const ZERO_RECT = {
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as unknown as DOMRect;

const originalGetClientRects = Range.prototype.getClientRects;
const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect;

beforeEach(() => {
  Range.prototype.getClientRects = (() =>
    [ZERO_RECT] as unknown as DOMRectList) as typeof Range.prototype.getClientRects;
  Range.prototype.getBoundingClientRect = (() =>
    ZERO_RECT) as typeof Range.prototype.getBoundingClientRect;
  installNativeClickMapping();
});

afterEach(() => {
  Range.prototype.getClientRects = originalGetClientRects;
  Range.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

/** Mirror of LiveEditor's liveDecorations field (same body, no React graph). */
const liveDecorations = StateField.define({
  create(state: EditorState) {
    return computeDecorations(state.doc, syntaxTree(state).topNode, state.selection.ranges);
  },
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    return computeDecorations(tr.state.doc, syntaxTree(tr.state).topNode, tr.state.selection.ranges);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The e2e scratch-note document the Home-key probe was taken against. */
const DOC = [
  "# Scratch heading",
  "",
  "Seed paragraph with `wardcode` and **strong word** and <u>undered</u> and ~~struck~~.",
  "",
  "> quoted line one",
  "> quoted line two",
  "",
  "- bullet alpha",
  "- bullet beta",
  "",
  "1. ordered one",
  "2. ordered two",
  "",
  "---",
  "",
  "```text",
  "fence plain",
  "```",
  "",
  "End [[Vael'Thor|the city]] here.",
].join("\n");

function makeView(): EditorView {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return new EditorView({
    parent: host,
    state: EditorState.create({
      doc: DOC,
      extensions: [
        markdownLanguage,
        EditorView.lineWrapping,
        liveDecorations,
        keymap.of([...defaultKeymap]),
      ],
    }),
  });
}

/** Chromium's native hit-test result at the Home probe point, as measured
 * in a real chromium run: the scroller element itself, offset 0. */
function stubNativeHit(node: Node, offset: number): () => void {
  const doc = document as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => unknown;
  };
  const saved = doc.caretPositionFromPoint;
  doc.caretPositionFromPoint = () => ({ offsetNode: node, offset });
  return () => {
    doc.caretPositionFromPoint = saved;
  };
}

/** Record view.posAtDOM calls on a real view (instance shadow). */
function spyPosAtDOM(view: EditorView): [Node, number][] {
  const calls: [Node, number][] = [];
  const original = view.posAtDOM.bind(view);
  (view as unknown as { posAtDOM: (n: Node, o: number) => number }).posAtDOM = (n, o) => {
    calls.push([n, o]);
    return original(n, o);
  };
  return calls;
}

describe("posAtCoords override vs Home/End edge probes (lineWrapping live view)", () => {
  it("rejects the Home edge probe when native hit-testing lands on the scroller", () => {
    const view = makeView();
    const scroller = view.dom.querySelector(".cm-scroller");
    expect(scroller).not.toBeNull();
    // Caret deep in the document — Home must stay on its line.
    const line20 = view.state.doc.line(20);
    view.dispatch({ selection: EditorSelection.cursor(line20.to) });

    const restore = stubNativeHit(scroller as Node, 0);
    const calls = spyPosAtDOM(view);
    try {
      const edgeProbe = { x: view.dom.getBoundingClientRect().left + 1, y: 500 };
      const pos = view.posAtCoords(edgeProbe);
      // The override must never map an out-of-content hit through posAtDOM —
      // that path produced document position 0 (the reported Home jump).
      for (const [node] of calls) {
        expect(view.contentDOM.contains(node)).toBe(true);
      }
      expect(pos).not.toBe(0);
    } finally {
      restore();
      view.destroy();
    }
  });

  it("still maps an in-content native hit through posAtDOM (click accuracy)", () => {
    const view = makeView();
    const line = view.contentDOM.querySelector(".cm-line");
    const textNode = line?.firstChild;
    expect(textNode).not.toBeNull();

    const restore = stubNativeHit(textNode as Node, 0);
    const calls = spyPosAtDOM(view);
    try {
      const pos = view.posAtCoords({ x: 40, y: 30 });
      expect(calls).toContainEqual([textNode, 0]);
      expect(pos).toBe(view.posAtDOM(textNode as Node, 0));
    } finally {
      restore();
      view.destroy();
    }
  });
});
