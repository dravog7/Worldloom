/**
 * Click-accuracy override for CodeMirror 6 (ADR-005 companion).
 *
 * PROBLEM (empirically reproduced, 2026-10-12, CM6 6.43.14, Chromium AND
 * Firefox, DPR 1, no zoom): whenever any `Decoration.line()` is active,
 * CM6's own `posAtCoords` maps click coordinates to a position ONE LINE
 * BELOW the clicked line. Real CDP mouse input on a real (non-headless)
 * browser reproduced it on every line-decoration view; a decoration-free
 * control view was pixel-perfect. In Worldloom this surfaced as "clicking
 * a list item edits the item below it" — every heading/quote/fenced block
 * carries a line class, shifting all clicks beneath it.
 *
 * FIX (precedent: Tolaria "bypass CodeMirror posAtCoords for accurate
 * cursor"): prefer the BROWSER's native caret hit-testing
 * (`document.caretPositionFromPoint`, falling back to
 * `caretRangeFromPoint`) and map the resulting DOM position through
 * `view.posAtDOM`. Validated on the same real-window setup: native
 * mapping was exact at every probed position on the broken views.
 *
 * Scope: a single, idempotent prototype override installed once per app
 * load. `posAtCoords` has no extension point in CM6, and every internal
 * coordinate consumer (mousedown, drag selection, double-click word
 * selection) routes through this method, so an override fixes the whole
 * family without touching event flow. The original implementation is kept
 * as fallback whenever native hit-testing returns nothing (outside the
 * viewport, foreign DOM, etc.), so behavior can only improve, never
 * regress to worse than stock CM6.
 */
import { EditorView } from "@codemirror/view";

interface CaretPositionLike {
  offsetNode: Node;
  offset: number;
}

/**
 * Native hit-test: document position under (x, y), or null when the
 * platform offers no usable hit-testing at these coordinates.
 */
export function nativePosAtCoords(view: EditorView, x: number, y: number): number | null {
  if (typeof document === "undefined") return null;
  try {
    const doc = document as unknown as {
      caretPositionFromPoint?: (x: number, y: number) => CaretPositionLike | null;
      caretRangeFromPoint?: (x: number, y: number) => { startContainer: Node; startOffset: number } | null;
    };
    if (typeof doc.caretPositionFromPoint === "function") {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos && pos.offsetNode) return view.posAtDOM(pos.offsetNode, pos.offset);
      return null;
    }
    if (typeof doc.caretRangeFromPoint === "function") {
      const r = doc.caretRangeFromPoint(x, y);
      if (r && r.startContainer) return view.posAtDOM(r.startContainer, r.startOffset);
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

let installed = false;

/**
 * Installs the override once per app load. Idempotent.
 * Signature preserved: (coords: {x, y}, precise?: boolean) => number | null.
 */
export function installNativeClickMapping(): void {
  if (installed) return;
  installed = true;
  type Coords = { x: number; y: number };
  // The public types are overloads that don't admit a runtime `boolean`
  // second argument (CM6's own mouse handlers pass one), so we operate on
  // the structurally-compatible loose signatures.
  const proto = EditorView.prototype as unknown as {
    posAtCoords: (this: EditorView, coords: Coords, precise?: boolean) => number | null;
    posAndSideAtCoords: (
      this: EditorView,
      coords: Coords,
      precise?: boolean,
    ) => { pos: number; assoc: number } | null;
  };
  const original = proto.posAtCoords;
  const originalSide = proto.posAndSideAtCoords;

  // Native hit-testing is both fast AND exact, so it is preferred for
  // every call, including CM6's internal `precise=false` mouse paths
  // (basicMouseSelection passes false — skipping those would leave the
  // click bug alive exactly where it hurts).
  proto.posAtCoords = function (coords: Coords, precise = true): number | null {
    const native = nativePosAtCoords(this, coords.x, coords.y);
    if (native !== null) return native;
    return original.call(this, coords, precise);
  };

  // The MOUSE SELECTION path (mousedown, drag extension, double/triple
  // click) resolves coordinates through `posAndSideAtCoords`, not
  // `posAtCoords` — CM6 dist: basicMouseSelection(). Both methods must be
  // overridden or the click bug survives on every real click.
  proto.posAndSideAtCoords = function (
    coords: Coords,
    precise = true,
  ): { pos: number; assoc: number } | null {
    const native = nativePosAtCoords(this, coords.x, coords.y);
    if (native !== null) return { pos: native, assoc: 0 };
    return originalSide.call(this, coords, precise);
  };
}
