import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { autocompletion } from "@codemirror/autocomplete";
import {
  createWikilinkCompletionSource,
  type WikilinkLookup,
} from "./autocomplete";
import {
  createAutosaveController,
  type AutosaveController,
} from "./autosave";
import { shouldReplaceDoc } from "./doc-sync";
import "./editor.css";

export type EditorStatus = "saved" | "saving" | "dirty";

export interface EditorPaneProps {
  /** Vault-relative path of the note being edited (ADR-002 identity). */
  path: string;
  /** Current on-disk content for `path` (watcher echo or initial load). */
  content: string;
  /** Injected fuzzy lookup — in the app, MemoryIndex.byTitleOrAlias. */
  lookup: WikilinkLookup;
  /** Persist one note; in the app this is the vault service's atomic save. */
  onSave: (path: string, content: string) => void | Promise<void>;
  /** Status indicator sink (PLAN-M1 C1: saving/saved/dirty). */
  onStatusChange: (status: EditorStatus) => void;
}

/** Dark CodeMirror theme with a transparent background (app paints the chrome). */
const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "transparent",
      color: "var(--wl-text, #e8e2d4)",
    },
    ".cm-content": {
      backgroundColor: "transparent",
      caretColor: "var(--wl-accent, #d9a441)",
      padding: "12px 16px",
    },
    ".cm-scroller": {
      fontFamily:
        "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
      fontSize: "15px",
      lineHeight: "1.65",
    },
    ".cm-gutters": {
      backgroundColor: "transparent",
      color: "var(--wl-faint, #5c5648)",
      border: "none",
      paddingRight: "4px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--wl-text, #e8e2d4)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--wl-accent, #d9a441)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "rgba(120, 150, 220, 0.28)" },
    ".cm-tooltip.cm-tooltip-autocomplete": {
      backgroundColor: "var(--wl-panel, #26221a)",
      border: "1px solid var(--wl-line, #3a3528)",
      color: "var(--wl-text, #e8e2d4)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--wl-accent-dim, #3a3324)",
    },
  },
  { dark: true },
);

/**
 * Thin CodeMirror 6 markdown editor (PLAN-M1 C1).
 *
 * All behaviour lives in tested pure modules — `autocomplete.ts` (the `[[`
 * completion source), `autosave.ts` (debounced save controller) and
 * `doc-sync.ts` (external-content adoption rule). This component only wires
 * CM6 to those modules and to injected props (no vault/index imports).
 */
export function EditorPane({
  path,
  content,
  lookup,
  onSave,
  onStatusChange,
}: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Latest props, reachable from CodeMirror callbacks without rebuilding.
  const latestRef = useRef({ lookup, onSave, onStatusChange });
  latestRef.current = { lookup, onSave, onStatusChange };

  // Content last known to be persisted (disk truth for the current path).
  const syncedRef = useRef(content);
  const pathRef = useRef(path);

  const controllerRef = useRef<AutosaveController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createAutosaveController({
      save: async (savePath, text) => {
        latestRef.current.onStatusChange("saving");
        await latestRef.current.onSave(savePath, text);
        if (pathRef.current !== savePath) return; // stale note's save finished
        syncedRef.current = text;
        const view = viewRef.current;
        const currentDoc = view ? view.state.doc.toString() : text;
        latestRef.current.onStatusChange(
          currentDoc === text ? "saved" : "dirty",
        );
      },
    });
  }
  const controller = controllerRef.current;

  // Mount once: build the CM6 view; tear it down (and flush) on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const state = EditorState.create({
      doc: content,
      extensions: [
        markdown(),
        autocompletion({
          override: [
            createWikilinkCompletionSource(
              (query) => latestRef.current.lookup(query),
            ),
          ],
        }),
        lineNumbers(),
        editorTheme,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          if (text === syncedRef.current) return; // external adoption, not typing
          latestRef.current.onStatusChange("dirty");
          controller.schedule(pathRef.current, text);
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
      // Don't lose the tail of typing when the pane unmounts.
      void controller.flush();
    };
  }, []);

  // Adopt external content: a path change always; the same path only when
  // there are no unsaved local edits (never clobber the user's typing).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (path !== pathRef.current) {
      pathRef.current = path;
      syncedRef.current = content;
      if (currentDoc !== content) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content },
        });
      }
      onStatusChange("saved");
      return;
    }
    if (content === currentDoc) {
      syncedRef.current = content;
      return;
    }
    const dirty = currentDoc !== syncedRef.current;
    if (shouldReplaceDoc(path, currentDoc, dirty, path, content)) {
      syncedRef.current = content;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
      });
      onStatusChange("saved");
    }
  }, [path, content, onStatusChange]);

  return <div ref={hostRef} className="wl-editor-pane" data-path={path} />;
}
