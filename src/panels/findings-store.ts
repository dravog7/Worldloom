/**
 * M2 Wave D2 — panel-LOCAL UI state for the Findings panel (PLAN-M2 §D2).
 *
 * Holds only ephemeral view state: the running flag, LLM batch progress,
 * expanded note groups, the refresh counter, and the last error. Findings
 * themselves are NEVER stored here — the panel derives rows from findings +
 * tombstones (buildFindingRows) and bumps `refreshCounter` after every audit
 * or dismissal to re-derive. Tombstones live in the AuditStatePort file, not
 * here; a panel remount re-reads them and loses nothing.
 *
 * `createFindingsUiStore()` exists so tests get isolated instances; the panel
 * uses the module singleton (one findings panel per app, I1 wiring).
 */
import { create } from "zustand";

export type FindingsPhase =
  | "idle" // nothing run yet this session
  | "rules" // rules pass running (synchronous in practice; kept for symmetry)
  | "confirm" // waiting on the cost-estimate confirmation
  | "llm" // LLM batches in flight
  | "done" // last run finished (findings shown)
  | "error"; // last run failed (message in lastError)

export interface FindingsUiState {
  running: boolean;
  phase: FindingsPhase;
  /** LLM batch counter while phase === "llm" (done of total). */
  progressDone: number;
  progressTotal: number;
  /** Note paths with their finding group expanded (collapsed = absent). */
  expanded: ReadonlySet<string>;
  /** Bumped after every audit/dismiss; the panel re-derives rows from it. */
  refreshCounter: number;
  /** Human-readable failure from the last run; null when healthy. */
  lastError: string | null;
}

export const initialFindingsUiState: FindingsUiState = {
  running: false,
  phase: "idle",
  progressDone: 0,
  progressTotal: 0,
  expanded: new Set<string>(),
  refreshCounter: 0,
  lastError: null,
};

export interface FindingsUiActions {
  setRunning(running: boolean): void;
  setPhase(phase: FindingsPhase): void;
  setProgress(done: number, total: number): void;
  /** Replace the expanded set (e.g. expand-all after a fresh audit). */
  setExpanded(paths: Iterable<string>): void;
  toggleGroup(path: string): void;
  bumpRefresh(): void;
  setError(message: string | null): void;
  reset(): void;
}

export type FindingsUiStore = FindingsUiState & FindingsUiActions;

export function createFindingsUiStore() {
  return create<FindingsUiStore>()((set, get) => ({
    ...initialFindingsUiState,
    setRunning: (running) => set({ running }),
    setPhase: (phase) => set({ phase }),
    setProgress: (done, total) => set({ progressDone: done, progressTotal: total }),
    setExpanded: (paths) => set({ expanded: new Set(paths) }),
    toggleGroup: (path) => {
      const next = new Set(get().expanded);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      set({ expanded: next });
    },
    bumpRefresh: () => set({ refreshCounter: get().refreshCounter + 1 }),
    setError: (message) => set({ lastError: message }),
    reset: () =>
      set({ ...initialFindingsUiState, expanded: new Set<string>(), lastError: null }),
  }));
}

/** Panel-wide singleton (one findings panel per app); tests use the factory. */
export const useFindingsUi = createFindingsUiStore();
