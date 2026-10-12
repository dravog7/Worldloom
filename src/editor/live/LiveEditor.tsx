/**
 * Live Preview editing surface (ADR-005): the document stays raw markdown
 * bytes; in 'live' mode syntax is hidden and styled via decorations, in
 * 'source' mode the raw markdown shows. Logic lives in the tested pure
 * modules (decorations/reveal/toolbar, autosave/doc-sync/autocomplete from
 * C1) — this file is only the CM6 assembly + toolbar row.
 */
import { useEffect, useMemo, useRef } from "react";
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
import { createAutosaveController } from "../autosave";
import { createWikilinkCompletionSource, type WikilinkLookup } from "../autocomplete";
import { shouldReplaceDoc } from "../doc-sync";
import { computeDecorations } from "./decorations";
import { revealLines } from "./reveal";
import { applyToolbarAction, type ToolbarAction } from "./toolbar";
import "./live.css";

export interface LiveEditorProps {
  path: string;
  content: string;
  lookup: WikilinkLookup;
  onSave: (path: string, content: string) => void | Promise<void>;
  onStatusChange: (status: "saved" | "saving" | "dirty") => void;
  mode: "live" | "source";
}

/** Decoration field: recompute on every doc/selection change (M1 scale). */
export const liveDecorations = StateField.define<DecorationSet>({
  create(state) {
    return computeDecorations(
      state.doc,
      syntaxTree(state).topNode,
      revealLines(state.selection.ranges, state.doc),
    );
  },
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    return computeDecorations(
      tr.state.doc,
      syntaxTree(tr.state).topNode,
      revealLines(tr.state.selection.ranges, tr.state.doc),
    );
  },
  provide: (field) => EditorView.decorations.from(field),
});

const TOOLBAR: { action: ToolbarAction; label: string; title: string }[] = [
  { action: "bold", label: "B", title: "Bold (**)" },
  { action: "italic", label: "I", title: "Italic (*)" },
  { action: "code", label: "</>", title: "Inline code" },
  { action: "h1", label: "H1", title: "Heading 1" },
  { action: "h2", label: "H2", title: "Heading 2" },
  { action: "quote", label: "❝", title: "Quote" },
  { action: "bullet", label: "•", title: "Bullet list" },
  { action: "wikilink", label: "[[", title: "Wikilink" },
];

export function LiveEditor({ path, content, lookup, onSave, onStatusChange, mode }: LiveEditorProps) {
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
          }),
          EditorView.theme({}, { dark: true }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
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
      <div className="wl-md-toolbar" role="toolbar" aria-label="Formatting">
        {TOOLBAR.map((button) => (
          <button
            key={button.action}
            type="button"
            title={button.title}
            aria-label={button.title}
            className={`wl-md-btn wl-md-btn-${button.action}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runAction(button.action)}
          >
            {button.label}
          </button>
        ))}
        <span className="wl-md-toolbar-hint">
          {mode === "live" ? "Live — no code, only what you write" : "Markdown source"}
        </span>
      </div>
      <div ref={hostRef} className="wl-live-host" />
    </div>
  );
}
