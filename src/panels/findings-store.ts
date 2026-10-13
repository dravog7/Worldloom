/**
 * M2 Wave D2 — panel-LOCAL UI state for the Findings panel (PLAN-M2 §D2).
 *
 * Holds the ephemeral view state (running flag, LLM batch progress, expanded
 * note groups, refresh counter, last error) PLUS the last run's findings and
 * pre-plan/estimate. Findings live here because the App rail unmounts this
 * panel on every tab switch and a re-audit cannot re-derive them: after a
 * completed LLM pass `lastAudit` makes the plan batch-free, so paid findings
 * stored anywhere mount-scoped are gone for good (M2 I4 #2). The panel
 * derives rows from `findings` + tombstones (buildFindingRows). Tombstones
 * live in the AuditStatePort file, not here; a panel remount re-reads them
 * and loses nothing.
 *
 * `createFindingsUiStore()` exists so tests get isolated instances; the panel
 * uses the module singleton (one findings panel per app, I1 wiring).
 */
import { create } from "zustand";
import type { AuditFinding } from "../core/audit/llm";
import type { AuditCostEstimate, AuditPassPlan } from "../core/audit/findings-view";

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
  /** Raw findings from the last run (rules + retained LLM) — survives remounts. */
  findings: AuditFinding[];
  /** Last LLM pre-plan + cost estimate (keeps the confirm dialog alive). */
  plan: AuditPassPlan | null;
  estimate: AuditCostEstimate | null;
  /** At least one audit ran — drives the Re-audit label + first-run expand. */
  hasRun: boolean;
}

export const initialFindingsUiState: FindingsUiState = {
  running: false,
  phase: "idle",
  progressDone: 0,
  progressTotal: 0,
  expanded: new Set<string>(),
  refreshCounter: 0,
  lastError: null,
  findings: [],
  plan: null,
  estimate: null,
  hasRun: false,
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
  /** Replaces the raw findings (new run result; tombstone filtering is later). */
  setFindings(findings: AuditFinding[]): void;
  /** Stores the latest pre-run plan + estimate for the confirm dialog. */
  setAuditPlan(plan: AuditPassPlan | null, estimate: AuditCostEstimate | null): void;
  setHasRun(hasRun: boolean): void;
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
    setFindings: (findings) => set({ findings }),
    setAuditPlan: (plan, estimate) => set({ plan, estimate }),
    setHasRun: (hasRun) => set({ hasRun }),
    reset: () =>
      set({
        ...initialFindingsUiState,
        expanded: new Set<string>(),
        findings: [],
        plan: null,
        estimate: null,
        lastError: null,
      }),
  }));
}

/** Panel-wide singleton (one findings panel per app); tests use the factory. */
export const useFindingsUi = createFindingsUiStore();
