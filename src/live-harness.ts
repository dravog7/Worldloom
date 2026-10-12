/**
 * Dev-only live-editor harness (diagnostics, not shipped in `vite build`).
 * Mounts the REAL live-preview decoration pipeline (the `liveDecorations`
 * StateField from LiveEditor.tsx) on a fixture document so click → caret
 * mapping can be probed programmatically in a real layout engine.
 *
 * Usage: open http://localhost:1420/harness.html, then in the console:
 *   __probe.caret()        → selection head (doc position)
 *   __probe.line()         → { line, text } of the caret's line
 *   __probe.clickLine(n,7) → real mousedown/mouseup/click at line n, char 7
 *   __probe.clickBullet(n) → click the rendered • of the nth bullet
 *   __probe.doc()          → document text
 */
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, Decoration, WidgetType } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { liveDecorations } from "./editor/live/LiveEditor";
import { installNativeClickMapping } from "./editor/live/click-map";

// Apply the click-accuracy override in the harness as well.
installNativeClickMapping();
import "./editor/live/live.css";

const DOC = `# Probe

- Alpha item
- Bravo item
- Charlie item
- Delta item
- Echo item

- Nest parent
  - Nest child

End paragraph.
`;

const state = EditorState.create({
  doc: DOC,
  extensions: [
    markdownLanguage,
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    liveDecorations,
    EditorView.theme({}, { dark: true }),
  ],
});

const view = new EditorView({ state, parent: document.getElementById("app")! });

// Control editor: identical config minus liveDecorations — isolates whether
// the decoration pipeline affects click→position mapping.
const statePlain = EditorState.create({
  doc: DOC,
  extensions: [
    markdownLanguage,
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.theme({}, { dark: true }),
  ],
});
const viewPlain = new EditorView({ state: statePlain, parent: document.getElementById("plain")! });

// --- Bisect views: which decoration kind breaks posAtCoords? ---
class DotWidget extends WidgetType {
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.textContent = "•";
    return s;
  }
}
// Replace-only: hide the `-` of line 3 with a bullet widget (mimics listItem)
const repDeco = Decoration.replace({ widget: new DotWidget() }).range(9, 10);
const viewReplace = new EditorView({
  state: EditorState.create({
    doc: DOC,
    extensions: [markdownLanguage, EditorView.lineWrapping, EditorView.decorations.of(Decoration.set([repDeco])), EditorView.theme({}, { dark: true })],
  }),
  parent: document.getElementById("replace")!,
});
// Line-class-only: style line 3
const lineDeco = Decoration.line({ class: "wl-md-h2" }).range(9);
const viewLine = new EditorView({
  state: EditorState.create({
    doc: DOC,
    extensions: [markdownLanguage, EditorView.lineWrapping, EditorView.decorations.of(Decoration.set([lineDeco])), EditorView.theme({}, { dark: true })],
  }),
  parent: document.getElementById("lineclass")!,
});
// line deco WITHOUT lineWrapping — is wrapping the trigger?
const viewLineNowrap = new EditorView({
  state: EditorState.create({
    doc: DOC,
    extensions: [markdownLanguage, EditorView.decorations.of(Decoration.set([lineDeco])), EditorView.theme({}, { dark: true })],
  }),
  parent: document.getElementById("linenowrap")!,
});
// line deco WITH wrapping but a style-less class — does the CSS matter?
const bareDeco = Decoration.line({ class: "probe-bare" }).range(9);
const viewLineBare = new EditorView({
  state: EditorState.create({
    doc: DOC,
    extensions: [markdownLanguage, EditorView.lineWrapping, EditorView.decorations.of(Decoration.set([bareDeco])), EditorView.theme({}, { dark: true })],
  }),
  parent: document.getElementById("linebare")!,
});
function roundtripWith(v: EditorView, pos: number): unknown {
  const c = v.coordsAtPos(pos);
  if (!c) return { pos, error: "no coords" };
  const x = (c.left + c.right) / 2, y = (c.top + c.bottom) / 2;
  return { pos, back: v.posAtCoords({ x, y }) };
}

const fire = (x: number, y: number): void => {
  for (const t of ["mousedown", "mouseup", "click"]) {
    view.contentDOM.dispatchEvent(
      new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y }),
    );
  }
};

(window as unknown as Record<string, unknown>).__probe = {
  view,
  caret: () => view.state.selection.main.head,
  line: () => {
    const l = view.state.doc.lineAt(view.state.selection.main.head);
    return { line: l.number, text: l.text };
  },
  doc: () => view.state.doc.toString(),
  clickLine: (n: number, ch: number) => {
    const l = view.state.doc.line(n);
    const coords = view.coordsAtPos(l.from + ch);
    if (!coords) return { error: "no coords" };
    fire(coords.left + 2, (coords.top + coords.bottom) / 2);
    return { clicked: n, ch, caret: view.state.selection.main.head };
  },
  clickBullet: (n: number) => {
    const widgets = view.contentDOM.querySelectorAll<HTMLElement>(".wl-md-bullet");
    const w = widgets[n - 1];
    if (!w) return { error: "no widget", found: widgets.length };
    const r = w.getBoundingClientRect();
    fire(r.left + r.width / 2, r.top + r.height / 2);
    return { clickedBullet: n, caret: view.state.selection.main.head };
  },
  plain: {
    view: viewPlain,
    roundtrip: (pos: number) => {
      const c = viewPlain.coordsAtPos(pos);
      if (!c) return { pos, error: "no coords" };
      const x = (c.left + c.right) / 2, y = (c.top + c.bottom) / 2;
      return { pos, back: viewPlain.posAtCoords({ x, y }) };
    },
  },
  bisect: { viewReplace, viewLine, viewLineNowrap, viewLineBare, roundtripWith },
};

// Auto-runner: computes roundtrips on every editor and publishes results so
// any engine (manual browser, headless Chrome dump-dom) can read them.
setTimeout(() => {
  const rt = roundtripWith;
  const results = {
    engine: navigator.userAgent.slice(0, 60),
    decorated: [12, 16, 40].map((p) => rt(view, p)),
    plain: [12, 16, 40].map((p) => rt(viewPlain, p)),
    replace_only: [12, 16, 40].map((p) => rt(viewReplace, p)),
    line_only: [12, 16, 40].map((p) => rt(viewLine, p)),
    line_nowrap: [12, 16, 40].map((p) => rt(viewLineNowrap, p)),
    line_bare_class: [12, 16, 40].map((p) => rt(viewLineBare, p)),
  };
  (window as unknown as Record<string, unknown>).__results = results;
  const pre = document.createElement("pre");
  pre.id = "results";
  pre.textContent = "RESULTS:" + JSON.stringify(results);
  document.body.appendChild(pre);
}, 500);
