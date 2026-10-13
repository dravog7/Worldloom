import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { AiSettings } from "../core/ai/settings";
import type { Transport } from "../core/ai/types";
import type { IndexProvider } from "../core/index/provider";
import {
  buildFindingRows,
  estimateAuditCost,
  formatUsd,
  groupFindingsByNote,
  llmAuditGate,
  planAuditPass,
  type AuditCostEstimate,
  type AuditPassPlan,
} from "../core/audit/findings-view";
import {
  dismissFinding,
  emptyAuditState,
  loadAuditState,
  mergeAuditFindings,
  runLlmAudit,
  serializeAuditState,
  type AuditState,
  type AuditStatePort,
} from "../core/audit/llm";
import { auditRules, type Finding } from "../core/audit/rules";
import type { AuditFinding } from "../core/audit/llm";
import { useFindingsUi } from "./findings-store";
import "./panels.css";

/**
 * M2 Wave D2 — Findings panel (PLAN-M2 §D2). Thin shell over the pure model
 * in core/audit/findings-view.ts:
 *
 * - "Run audit" always runs the offline rules pass (instant, free); the LLM
 *   pass only starts after the capability gate passes AND the user confirms
 *   the cost-estimate dialog (est. USD + batch count from planAuditPass —
 *   the exact batching the audit will use). Unconfigured AI degrades to a
 *   one-line note; the rules pass keeps working (ADR-004: BYO-AI, no
 *   auto-edits — the app never writes notes from this panel).
 * - Findings render grouped by note, collapsible, each row showing its kind
 *   badge, message, and one or two clickable quote blocks; a click asks the
 *   parent (onOpenNote) to open the note and reveal the quoted line.
 * - Dismiss writes a tombstone through the injected AuditStatePort FIRST,
 *   then re-derives rows (buildFindingRows filters isDismissed after merge),
 *   so a dismissed finding stays gone across re-audits and remounts.
 * - Panel-local UI state (running/progress/expanded/refresh) lives in the
 *   findings-store zustand store; findings themselves are derived, never
 *   stored there.
 *
 * The LLM transport is injected (default: none → rules-only), keeping this
 * component Tauri-free like every panel (I1 wires chatViaProxy in).
 */
export interface FindingsPanelProps {
  provider: IndexProvider | null;
  auditStatePort: AuditStatePort;
  aiSettings: AiSettings;
  /** Parent opens the note; line (0-based) reveals the quoted evidence. */
  onOpenNote: (path: string, line?: number) => void;
  /** Keyring presence flag (null = unknown/unavailable); feeds the gate. */
  aiKeyPresent?: boolean | null;
  /** Injected LLM transport; absent = rules pass only (dev/non-Tauri). */
  transport?: Transport;
  /** Preloaded tombstone state; otherwise loaded from the port on mount. */
  initialAuditState?: AuditState;
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function FindingsPanel(props: FindingsPanelProps): JSX.Element {
  const ui = useFindingsUi();
  const [auditState, setAuditState] = useState<AuditState>(
    props.initialAuditState ?? emptyAuditState(),
  );
  // Raw findings from the last run (rules, then merged LLM). Kept in a ref:
  // the rendered rows derive from refreshCounter + auditState + expanded.
  const rawRef = useRef<AuditFinding[]>([]);
  const planRef = useRef<AuditPassPlan | null>(null);
  const estimateRef = useRef<AuditCostEstimate | null>(null);
  const hasRunRef = useRef(false);

  const gate = llmAuditGate(props.aiSettings, props.aiKeyPresent ?? null);

  const rows = useMemo(
    () => buildFindingRows(rawRef.current, { auditState, expanded: ui.expanded }),
    // refreshCounter participates deliberately: each audit/dismiss bumps it
    // to force a re-derivation from the ref + current tombstones.
    [ui.refreshCounter, ui.expanded, auditState],
  );
  const visibleCount = rows.reduce((sum, group) => sum + group.findings.length, 0);

  // Tombstones come from the port (app data); unreadable = fresh state.
  useEffect(() => {
    let cancelled = false;
    void props.auditStatePort
      .read()
      .then((raw) => {
        if (!cancelled && props.initialAuditState === undefined) {
          setAuditState(loadAuditState(raw));
        }
      })
      .catch(() => {
        /* worst case = full re-audit; the next save rewrites clean state */
      });
    return () => {
      cancelled = true;
    };
  }, [props.auditStatePort, props.initialAuditState]);

  const runAudit = async (): Promise<void> => {
    const provider = props.provider;
    if (provider === null || ui.running) return;
    ui.setError(null);
    ui.setRunning(true);
    ui.setPhase("rules");
    try {
      // Re-read tombstones so this run suppresses anything dismissed since.
      const state = loadAuditState(await props.auditStatePort.read());
      setAuditState(state);
      // Rules pass — offline, instant, always. Replaces the previous run.
      const rules: Finding[] = auditRules(provider);
      rawRef.current = rules;
      // LLM pre-plan: same batching/token accounting the audit will use.
      const notes = provider.all();
      const plan = planAuditPass(notes, state);
      planRef.current = plan;
      estimateRef.current = estimateAuditCost(notes.length, plan.batches, {
        priceInputPerM: props.aiSettings.priceInputPerM,
        priceOutputPerM: props.aiSettings.priceOutputPerM,
        tokensPerBatch: plan.tokensPerBatch,
      });
      if (!hasRunRef.current) {
        hasRunRef.current = true;
        ui.setExpanded(groupFindingsByNote(rules).map((group) => group.path));
      }
      ui.bumpRefresh();
      const canRunLlm =
        gate.configured && props.transport !== undefined && plan.batches > 0;
      if (!canRunLlm) {
        ui.setRunning(false);
        ui.setPhase("done");
        return;
      }
      // Wait for the user to confirm the estimate (running stays true so a
      // second click cannot start a competing run).
      ui.setPhase("confirm");
    } catch (error) {
      ui.setError(describeError(error));
      ui.setRunning(false);
      ui.setPhase("error");
    }
  };

  const cancelLlm = (): void => {
    ui.setRunning(false);
    ui.setPhase("done");
  };

  const confirmLlm = async (): Promise<void> => {
    const provider = props.provider;
    const transport = props.transport;
    const plan = planRef.current;
    if (provider === null || transport === undefined || plan === null || plan.batches === 0) {
      cancelLlm();
      return;
    }
    ui.setPhase("llm");
    ui.setProgress(0, plan.batches);
    // Counting transport: one progress tick per COMPLETED batch, so the
    // counter reflects real network progress inside the single audit run.
    let done = 0;
    const counting: Transport = {
      async chat(request) {
        const response = await transport.chat(request);
        done += 1;
        ui.setProgress(Math.min(done, plan.batches), plan.batches);
        return response;
      },
    };
    try {
      const result = await runLlmAudit(provider, counting, props.auditStatePort, {
        baseUrl: props.aiSettings.baseUrl,
        model: props.aiSettings.model,
      });
      // Fresh rules findings + this run's LLM findings; the row build then
      // applies the tombstone filter (isDismissed) to the merged list.
      rawRef.current = mergeAuditFindings(
        rawRef.current.filter((finding) => finding.kind !== "llm-contradiction"),
        result.findings,
      );
      setAuditState(result.state);
      ui.bumpRefresh();
      ui.setPhase("done");
      ui.setRunning(false);
    } catch (error) {
      // Rules findings stay visible; the run's state was not persisted.
      ui.setError(describeError(error));
      ui.setPhase("error");
      ui.setRunning(false);
    }
  };

  const dismiss = async (findingId: string): Promise<void> => {
    const next = dismissFinding(auditState, findingId, Date.now());
    try {
      // Tombstone persists FIRST — a failed write must not hide the row.
      await props.auditStatePort.write(serializeAuditState(next));
    } catch (error) {
      ui.setError(`Could not save dismissal: ${describeError(error)}`);
      return;
    }
    setAuditState(next);
    ui.bumpRefresh();
  };

  const openQuote = (note: string, line: number): void => {
    props.onOpenNote(note, line >= 0 ? line : undefined);
  };

  const estimate = estimateRef.current;
  const plan = planRef.current;
  const pricesUnset =
    props.aiSettings.priceInputPerM === 0 && props.aiSettings.priceOutputPerM === 0;

  return (
    <section className="wl-panel wl-findings" aria-label="Findings">
      <header className="wl-panel-header wl-findings-header">
        <span>
          Findings <span className="wl-count">{visibleCount}</span>
        </span>
        <button
          type="button"
          className="wl-btn"
          disabled={props.provider === null || ui.running}
          onClick={() => void runAudit()}
        >
          {ui.running ? "Auditing…" : hasRunRef.current ? "Re-audit" : "Run audit"}
        </button>
      </header>

      {gate.note !== null && <p className="wl-hint wl-findings-note">{gate.note}</p>}

      {ui.phase === "llm" && (
        <p className="wl-findings-progress" role="status">
          Auditing with AI… batch {Math.min(ui.progressDone, ui.progressTotal)} of{" "}
          {ui.progressTotal}
        </p>
      )}
      {ui.lastError !== null && (
        <p className="wl-error wl-findings-error" role="alert">
          {ui.lastError}
        </p>
      )}

      {rows.length === 0 && !ui.running && (
        <p className="wl-empty">No contradictions found.</p>
      )}

      {rows.map((group) => (
        <div key={group.path} className="wl-finding-group">
          <button
            type="button"
            className="wl-finding-group-header"
            aria-expanded={group.expanded}
            onClick={() => ui.toggleGroup(group.path)}
          >
            <span className="wl-caret" aria-hidden="true">
              {group.expanded ? "▾" : "▸"}
            </span>
            <span className="wl-finding-group-path" title={group.path}>
              {group.path}
            </span>
            <span className="wl-count">{group.findings.length}</span>
          </button>
          {group.expanded &&
            group.findings.map((row) => (
              <div key={row.id} className="wl-finding">
                <div className="wl-finding-head">
                  <span className={`wl-kind wl-kind-${row.kind}`}>{row.kindLabel}</span>
                  <span className="wl-finding-message">{row.message}</span>
                  <button
                    type="button"
                    className="wl-dismiss"
                    onClick={() => void dismiss(row.id)}
                  >
                    Dismiss
                  </button>
                </div>
                {row.quotes.map((quote) => (
                  <button
                    key={quote.side}
                    type="button"
                    className="wl-quote"
                    title={quote.line >= 0 ? `${quote.note}:${quote.line + 1}` : quote.note}
                    onClick={() => openQuote(quote.note, quote.line)}
                  >
                    <span className="wl-quote-loc">
                      {quote.line >= 0 ? `${quote.note}:${quote.line + 1}` : quote.note}
                    </span>
                    <span className="wl-quote-text">{quote.quote}</span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      ))}

      {ui.phase === "confirm" && plan !== null && estimate !== null && (
        <div className="wl-palette-overlay" onClick={cancelLlm}>
          <div
            className="wl-panel wl-estimate"
            role="dialog"
            aria-label="Confirm AI audit"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="wl-panel-header">ai audit — cost estimate</div>
            <div className="wl-estimate-body">
              <p className="wl-hint">
                The rules pass already ran (offline, free). The AI pass sends{" "}
                <strong>
                  {plan.batches} batch{plan.batches === 1 ? "" : "es"}
                </strong>{" "}
                (~{plan.totalInputTokens.toLocaleString("en-US")} input tokens) covering
                notes changed since their last audit.
              </p>
              <p className="wl-estimate-cost">
                Estimated cost: <strong>{formatUsd(estimate.totalUsd)}</strong>{" "}
                <span className="wl-hint">
                  (input {formatUsd(estimate.inputUsd)} + output allowance)
                </span>
              </p>
              {pricesUnset && (
                <p className="wl-hint">
                  Cost table not set — add prices in AI settings for a real estimate.
                </p>
              )}
              <div className="wl-estimate-actions">
                <button type="button" className="wl-btn wl-btn-ghost" onClick={cancelLlm}>
                  Cancel
                </button>
                <button type="button" className="wl-btn" onClick={() => void confirmLlm()}>
                  Run AI pass
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
