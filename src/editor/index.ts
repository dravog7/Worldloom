/**
 * Editor pane public surface (Wave C1): thin CodeMirror 6 component over
 * tested pure modules (wikilink completion, autosave, doc adoption).
 */
export { EditorPane } from "./EditorPane";
export type { EditorPaneProps, EditorStatus } from "./EditorPane";

export { createWikilinkCompletionSource } from "./autocomplete";
export type {
  CompletionCandidate,
  CompletionProbe,
  ReadableDoc,
  ReadableState,
  WikilinkCompletionResult,
  WikilinkCompletionSource,
  WikilinkLookup,
  WikilinkOption,
} from "./autocomplete";

export { createAutosaveController } from "./autosave";
export type {
  AutosaveController,
  AutosaveOptions,
  AutosaveTimer,
} from "./autosave";

export { shouldReplaceDoc } from "./doc-sync";
