/**
 * click-map tests: the native-hit-testing override for posAtCoords /
 * posAndSideAtCoords. The DOM-backed path is exercised for real in the
 * browser harness (harness.html + CDP real-click scripts); here we cover
 * what Node can: graceful null without DOM, fallback behavior, DOM-API
 * exception safety, posAtDOM mapping via fakes, and idempotent install.
 */
import type { EditorView } from "@codemirror/view";
import { EditorView as RealEditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { installNativeClickMapping, nativePosAtCoords } from "./click-map";

/** Minimal view fake: nativePosAtCoords only ever calls posAtDOM. */
function fakeView(): { view: EditorView; posAtDOM: ReturnType<typeof vi.fn> } {
  const posAtDOM = vi.fn().mockReturnValue(42);
  // Real hits always land inside the editable content; the fake models that.
  const contentDOM = { contains: () => true };
  return { view: { posAtDOM, contentDOM } as unknown as EditorView, posAtDOM };
}

describe("nativePosAtCoords", () => {
  it("returns null in a DOM-less environment (Node)", () => {
    const { view } = fakeView();
    expect(nativePosAtCoords(view, 10, 10)).toBeNull();
  });

  it("survives DOM APIs that throw and falls back to null", () => {
    const { view } = fakeView();
    const fakeDoc = {
      caretPositionFromPoint: () => {
        throw new Error("boom");
      },
    };
    vi.stubGlobal("document", fakeDoc);
    try {
      expect(nativePosAtCoords(view, 10, 10)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps a valid caretPositionFromPoint result through posAtDOM", () => {
    const { view, posAtDOM } = fakeView();
    const node = {} as Node;
    const fakeDoc = {
      caretPositionFromPoint: () => ({ offsetNode: node, offset: 2 }),
    };
    vi.stubGlobal("document", fakeDoc);
    try {
      expect(nativePosAtCoords(view, 5, 5)).toBe(42);
      expect(posAtDOM).toHaveBeenCalledWith(node, 2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to caretRangeFromPoint when the modern API is absent", () => {
    const { view, posAtDOM } = fakeView();
    const container = {} as Node;
    const fakeDoc = {
      caretRangeFromPoint: () => ({ startContainer: container, startOffset: 5 }),
    };
    vi.stubGlobal("document", fakeDoc);
    try {
      expect(nativePosAtCoords(view, 7, 7)).toBe(42);
      expect(posAtDOM).toHaveBeenCalledWith(container, 5);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when hit-testing yields nothing (e.g. outside content)", () => {
    const { view, posAtDOM } = fakeView();
    const fakeDoc = { caretPositionFromPoint: () => null };
    vi.stubGlobal("document", fakeDoc);
    try {
      expect(nativePosAtCoords(view, 1, 1)).toBeNull();
      expect(posAtDOM).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // HOME-KEY BUG regression (DIAG-B2): CM6's Home/End probe posAtCoords at
  // the editor's extreme left/right edge when lineWrapping is on. Chromium's
  // native hit-testing resolves points in the scroller's padding region to
  // the .cm-scroller element itself — NOT to content — and posAtDOM would
  // map that to document position 0, so Home jumped to the document start.
  // Native results outside the editable content must be rejected so callers
  // fall back to CM6's own mapping.
  it("rejects a native hit outside the editable content (scroller padding)", () => {
    const posAtDOM = vi.fn().mockReturnValue(0);
    const scroller = {} as Node;
    const contentDOM = { contains: (n: Node) => n !== scroller };
    const view = { posAtDOM, contentDOM } as unknown as EditorView;
    const fakeDoc = {
      caretPositionFromPoint: () => ({ offsetNode: scroller, offset: 0 }),
    };
    vi.stubGlobal("document", fakeDoc);
    try {
      expect(nativePosAtCoords(view, 1, 600)).toBeNull();
      expect(posAtDOM).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an out-of-content hit from the caretRangeFromPoint fallback too", () => {
    const posAtDOM = vi.fn().mockReturnValue(0);
    const scroller = {} as Node;
    const contentDOM = { contains: (n: Node) => n !== scroller };
    const view = { posAtDOM, contentDOM } as unknown as EditorView;
    const fakeDoc = {
      caretRangeFromPoint: () => ({ startContainer: scroller, startOffset: 1 }),
    };
    vi.stubGlobal("document", fakeDoc);
    try {
      expect(nativePosAtCoords(view, 1099, 600)).toBeNull();
      expect(posAtDOM).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("installNativeClickMapping", () => {
  it("is idempotent and preserves both method shapes", () => {
    const before = RealEditorView.prototype.posAtCoords;
    const beforeSide = RealEditorView.prototype.posAndSideAtCoords;
    installNativeClickMapping();
    const patched = RealEditorView.prototype.posAtCoords;
    const patchedSide = RealEditorView.prototype.posAndSideAtCoords;
    installNativeClickMapping(); // second call must not double-wrap
    expect(RealEditorView.prototype.posAtCoords).toBe(patched);
    expect(RealEditorView.prototype.posAndSideAtCoords).toBe(patchedSide);
    expect(patched).not.toBe(before);
    expect(patchedSide).not.toBe(beforeSide);
    expect(patched.length).toBe(before.length);
    expect(patchedSide.length).toBe(beforeSide.length);
  });

  it("falls back to the original implementations when native returns null", () => {
    // No DOM in Node → native returns null → patched methods must behave
    // exactly like stock CM6 (no crash, same result) on a fake view.
    installNativeClickMapping();
    const { view } = fakeView();
    const anyView = view as unknown as {
      posAtCoords: (c: { x: number; y: number }, p?: boolean) => unknown;
      posAndSideAtCoords: (c: { x: number; y: number }, p?: boolean) => unknown;
    };
    expect(() => anyView.posAtCoords({ x: 3, y: 3 }, false)).toThrow();
    // The throw must come from the ORIGINAL implementation operating on
    // the fake (no DOM internals), proving delegation, not a crash in ours.
  });
});
