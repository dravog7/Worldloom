/**
 * Ctrl+K search-palette reducer (PLAN-M1 C3). Pure: no side effects, no
 * mutation, safe to drive from the zustand store (I1). The component
 * (SearchPalette.tsx) only renders this state and forwards keystrokes;
 * the Ctrl+K keybinding itself is bound by the parent.
 *
 * Cursor invariant: -1 when there are no hits, otherwise 0..hits.length-1.
 * Every action re-establishes it via clampCursor.
 */
import type { SearchHit } from "../core/types";

export interface SearchState {
  open: boolean;
  query: string;
  hits: SearchHit[];
  /** Index into `hits`; -1 means "nothing highlighted". */
  cursor: number;
}

export type SearchAction =
  | { type: "open" }
  | { type: "close" }
  /** User typed; an empty query clears stale hits (nothing was searched). */
  | { type: "type"; query: string }
  /** Latest results from IndexProvider.search for the current query. */
  | { type: "setHits"; hits: SearchHit[] }
  /** Keyboard navigation; wraps at both ends. */
  | { type: "move"; delta: number };

export const initialSearchState: SearchState = {
  open: false,
  query: "",
  hits: [],
  cursor: -1,
};

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "open":
      // Fresh palette every time — stale queries/hits from last open confuse.
      return { open: true, query: "", hits: [], cursor: -1 };
    case "close":
      return { ...initialSearchState };
    case "type": {
      // Empty query → hits cleared (nothing to show); non-empty keeps the
      // last results until the caller setHits (or clears them) for the new
      // query, with the cursor clamped if the list shrank meanwhile.
      const hits = action.query === "" ? [] : state.hits;
      return { ...state, query: action.query, hits, cursor: clampCursor(state.cursor, hits.length) };
    }
    case "setHits": {
      const hits = action.hits;
      return { ...state, hits, cursor: hits.length > 0 ? 0 : -1 };
    }
    case "move": {
      if (state.hits.length === 0) return { ...state, cursor: -1 };
      const size = state.hits.length;
      // -1 (no selection yet): first move lands on 0 going down, on the
      // last hit going up.
      const from = state.cursor < 0 ? (action.delta > 0 ? -1 : 0) : state.cursor;
      const next = (((from + action.delta) % size) + size) % size;
      return { ...state, cursor: next };
    }
  }
}

/**
 * The hit under the cursor, or null when nothing is selected (empty palette,
 * stale cursor). Parent calls this on Enter and then dispatches "close".
 */
export function select(state: SearchState): SearchHit | null {
  return state.hits[state.cursor] ?? null;
}

function clampCursor(cursor: number, hitCount: number): number {
  if (hitCount === 0) return -1;
  if (cursor < 0) return 0;
  return Math.min(cursor, hitCount - 1);
}
