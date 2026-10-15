/**
 * Live Preview editing surface (ADR-005): the document stays raw markdown
 * bytes; in 'live' mode syntax is hidden and styled via decorations, in
 * 'source' mode the raw markdown shows. Logic lives in the tested pure
 * modules (decorations/toolbar, autosave/doc-sync/autocomplete from
 * C1) — this file is only the CM6 assembly + toolbar row.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Compartment, EditorState, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { bracketMatching, syntaxTree } from "@codemirror/language";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { installNativeClickMapping } from "./click-map";
import { createAutosaveController } from "../autosave";
import { createWikilinkCompletionSource, type WikilinkLookup } from "../autocomplete";
import { shouldReplaceDoc } from "../doc-sync";
import { computeDecorations } from "./decorations";
import {
  applyToolbarAction,
  computeToolbarState,
  type ToolbarAction,
  type ToolbarState,
} from "./toolbar";
import { ToolbarRow } from "./ToolbarRow";
import { createBehaviorKeymap } from "./behaviors";
import { NoteProperties } from "../../panels/NoteProperties";
import { parseNote } from "../../core/parser";
import "./toolbar.css";
import "./frontmatter-chip.css";
import "./live.css";

export interface LiveEditorProps {
  path: string;
  content: string;
  lookup: WikilinkLookup;
  onSave: (path: string, content: string) => void | Promise<void>;
  onStatusChange: (status: "saved" | "saving" | "dirty") => void;
  mode: "live" | "source";
  /** M2 I1 — reveal a 0-based line (audit quotes, backlinks). Nonce forces re-reveal. */
  reveal?: { line: number; nonce: number } | null;
}

// Click accuracy: CM6's posAtCoords misplaces clicks by one line whenever a
// line decoration is active (see click-map.ts for the full evidence); the
// native hit-testing override restores exact mapping. Installed once.
installNativeClickMapping();

/** Decoration field: recompute on every doc/selection change (M1 scale). */
export const liveDecorations = StateField.define<DecorationSet>({
  create(state) {
    return computeDecorations(
      state.doc,
      syntaxTree(state).topNode,
      state.selection.ranges,
    );
  },
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    return computeDecorations(
      tr.state.doc,
      syntaxTree(tr.state).topNode,
      tr.state.selection.ranges,
    );
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function LiveEditor({ path, content, lookup, onSave, onStatusChange, mode, reveal }: LiveEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const dirtyRef = useRef(false);
  const pathRef = useRef(path);
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;
  const modeCompartment = useMemo(() => new Compartment(), []);
  // W4: Word-toolbar state (block style + inline toggles) refreshed on every
  // selection/doc change below; properties popover opened by the W1 chip.
  const [toolbarState, setToolbarState] = useState<ToolbarState>({
    block: "normal",
    inline: { bold: false, italic: false, strike: false, code: false, underline: false },
  });
  const [propsOpen, setPropsOpen] = useState(false);
  // Parsed once per content version — read-only display for the popover.
  const propertiesNote = useMemo(() => parseNote(path, content), [path, content]);

  // Newest-content-wins debounce, one save in flight (tested C1 module).
  const controller = useMemo(
    () =>
      createAutosaveController({
        save: async (p: string, c: string) => {
          onStatusRef.current("saving");
          await onSaveRef.current(p, c);
          dirtyRef.current = false;
          onStatusRef.current("saved");
        },
        delayMs: 800,
      }),
    [],
  );

  const modeExtensions = (m: "live" | "source"): Extension[] =>
    m === "live"
      ? [EditorView.lineWrapping, liveDecorations]
      : [lineNumbers()]; // Word-like live view shows no line numbers

  // One editor view per note path; mode switches reconfigure in place.
  useEffect(() => {
    if (!hostRef.current) return;
    dirtyRef.current = false;
    pathRef.current = path;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          history(),
          closeBrackets(),
          bracketMatching(),
          markdownLanguage,
          keymap.of([
            ...closeBracketsKeymap,
            ...createBehaviorKeymap(), // Word behaviors — must precede indentWithTab (W3)
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          autocompletion({
            override: [createWikilinkCompletionSource((q) => lookupRef.current(q))],
          }),
          modeCompartment.of(modeExtensions(mode)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              dirtyRef.current = true;
              onStatusRef.current("dirty");
              controller.schedule(pathRef.current, update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              setToolbarState(
                computeToolbarState(update.state.doc, update.state.selection.main.head),
              );
            }
          }),
          EditorView.theme({}, { dark: true }),
        ],
      }),
    });
    viewRef.current = view;
    setToolbarState(computeToolbarState(view.state.doc, view.state.selection.main.head));
    const host = hostRef.current;
    const onOpenProps = () => setPropsOpen(true);
    host?.addEventListener("wl-open-properties", onOpenProps);
    return () => {
      host?.removeEventListener("wl-open-properties", onOpenProps);
      void controller.flush();
      view.destroy();
      viewRef.current = null;
    };
  }, [path]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: modeCompartment.reconfigure(modeExtensions(mode)),
    });
  }, [mode]);

  // M2 I1: external reveal (audit quote click / backlink) — select the line
  // and scroll it into view; runs after the doc is in place for this path.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal) return;
    const lineNo = Math.min(Math.max(reveal.line + 1, 1), view.state.doc.lines);
    const pos = view.state.doc.line(lineNo).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    view.focus();
  }, [reveal]);

  // External content (watcher echo / external edit) adoption — tested rule.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (shouldReplaceDoc(path, view.state.doc.toString(), dirtyRef.current, path, content)) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
      dirtyRef.current = false;
    }
  }, [content, path]);

  function runAction(action: ToolbarAction): void {
    const view = viewRef.current;
    if (!view) return;
    const tr = applyToolbarAction(view.state, action);
    if (tr) view.dispatch(tr);
    view.focus();
  }

  return (
    <div className="wl-live">
      <ToolbarRow state={toolbarState} onAction={runAction} />
      <div ref={hostRef} className="wl-live-host" />
      <NoteProperties
        open={propsOpen && mode === "live"}
        note={propertiesNote}
        onClose={() => setPropsOpen(false)}
      />
    </div>
  );
}
