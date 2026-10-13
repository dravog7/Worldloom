import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { Transport } from "../core/ai/transport";
import { ExtractionQueue, type QueueNoteInput } from "../core/ai/extraction-queue";
import { applyProposalsToSource } from "../core/ai/accept-extract";
import {
  acceptedFlagsFor,
  buildProposalRows,
  describeProposal,
  type ProposalRow,
} from "./extraction-proposals";
import "./panels.css";

/**
 * M2 Wave E1 — extraction proposals panel (PLAN-M2 §E1, PRD-M2 §3).
 *
 * Thin controlled component: the note (with its raw source), the transport,
 * and the save seam come in as props; every write goes through the injected
 * `onSave` (the atomic vault save) — this file never touches the filesystem.
 * Dismissals are tombstones keyed by proposal hash: they suppress the row
 * now AND filter future re-extractions; persist them via `onDismiss`.
 *
 * The panel owns an ExtractionQueue (concurrency 1, 2 notes/sec cap); the
 * endpoint prop should be memoized by the parent to avoid queue churn.
 */
export interface ExtractionPanelNote extends QueueNoteInput {
  /** Raw markdown source as stored on disk — Accept rewrites this string. */
  source: string;
}

export interface ExtractionPanelProps {
  note: ExtractionPanelNote;
  /** Injected transport (null while unavailable — e.g. non-Tauri dev). */
  transport: Transport | null;
  /** Injected save — the ONLY write path (atomic vault write, ARCH.md). */
  onSave: (path: string, newSource: string) => Promise<void>;
  /** False → the extract button is disabled with a setup tooltip (C2 CTA). */
  aiConfigured: boolean;
  /** OpenAI-compatible endpoint from aiSettings (baseUrl + model). */
  endpoint?: { baseUrl: string; model: string };
  /** Externally persisted tombstones (I1 may round-trip these hashes). */
  dismissed?: ReadonlySet<string>;
  /** Called for each newly dismissed proposal hash (persistence seam). */
  onDismiss?: (hash: string) => void;
}

interface Progress {
  done: number;
  total: number;
}

export function ExtractionPanel(props: ExtractionPanelProps): JSX.Element {
  const { note, transport, endpoint, aiConfigured, onSave } = props;
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [ownDismissed, setOwnDismissed] = useState<Set<string>>(() => new Set());

  // Merged tombstones: externally persisted + dismissed this session.
  const dismissed = useMemo(
    () => new Set<string>([...(props.dismissed ?? []), ...ownDismissed]),
    [props.dismissed, ownDismissed],
  );
  // The queue's async callbacks read the latest tombstones, not a snapshot.
  const dismissedRef = useRef(dismissed);
  dismissedRef.current = dismissed;

  // One queue per transport/endpoint pair; cancelled on swap/unmount.
  const queueRef = useRef<ExtractionQueue | null>(null);
  useEffect(() => {
    if (!transport || !endpoint) {
      queueRef.current = null;
      return;
    }
    const queue = new ExtractionQueue({
      transport,
      endpoint,
      onResult: (_note, outcome) => {
        setRunning(false);
        setProgress(null);
        if (!outcome.ok) {
          setRows([]);
          setNotice(outcome.error.message);
          return;
        }
        const fresh = buildProposalRows(outcome.proposals, dismissedRef.current);
        setRows(fresh);
        setApplied(false);
        setNotice(
          fresh.length === 0
            ? "Nothing new — the model repeated what the frontmatter already carries."
            : null,
        );
      },
      onProgress: (done, total) => setProgress({ done, total }),
    });
    queueRef.current = queue;
    return () => {
      queue.cancel();
      queueRef.current = null;
    };
  }, [transport, endpoint]);

  // Switching notes discards the previous note's pending proposals.
  useEffect(() => {
    setRows([]);
    setRunning(false);
    setApplied(false);
    setNotice(null);
    setProgress(null);
  }, [note.path]);

  const canExtract =
    aiConfigured && transport !== null && endpoint !== undefined && !running;
  const extractTooltip = !aiConfigured
    ? "Set up AI first — open Settings → AI settings, pick a provider and store an API key."
    : !transport
      ? "The AI transport is unavailable in this session."
      : !endpoint
        ? "No AI endpoint configured — open Settings → AI settings."
        : "Propose entities, aliases and relations for this note.";

  const checkedCount = rows.filter((row) => row.checked).length;

  const runExtract = (): void => {
    setNotice(null);
    setApplied(false);
    setProgress({ done: 0, total: 1 });
    setRunning(true);
    queueRef.current?.enqueue({ ...note });
  };

  const toggleRow = (id: string): void => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, checked: !row.checked } : row)),
    );
  };

  const dismissRow = (row: ProposalRow): void => {
    setOwnDismissed((current) => new Set(current).add(row.hash));
    props.onDismiss?.(row.hash);
    setRows((current) => current.filter((candidate) => candidate.id !== row.id));
  };

  const dismissAll = (): void => {
    for (const row of rows) props.onDismiss?.(row.hash);
    setOwnDismissed((current) => {
      const next = new Set(current);
      for (const row of rows) next.add(row.hash);
      return next;
    });
    setRows([]);
  };

  const acceptSelected = async (): Promise<void> => {
    if (checkedCount === 0 || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const merged = applyProposalsToSource(
        { path: note.path, source: note.source },
        rows.map((row) => row.proposal),
        acceptedFlagsFor(rows),
      );
      await onSave(note.path, merged);
      setRows([]);
      setApplied(true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="wl-panel wl-extract" aria-label="Extraction proposals">
      <header className="wl-panel-header">
        extract proposals
        {progress !== null && (
          <span className="wl-count">
            {progress.done}/{progress.total}
          </span>
        )}
      </header>

      <div className="wl-extract-controls">
        <button
          type="button"
          className="wl-btn"
          disabled={!canExtract}
          title={extractTooltip}
          onClick={runExtract}
        >
          {running ? "Extracting…" : "Extract entities"}
        </button>
      </div>

      {applied && <p className="wl-extract-applied">✓ applied to frontmatter</p>}
      {notice && <p className="wl-extract-notice">{notice}</p>}

      {rows.length > 0 && (
        <ul className="wl-extract-rows">
          {rows.map((row) => {
            const descriptor = describeProposal(row.proposal);
            const percent = Math.round(descriptor.confidence * 100);
            return (
              <li key={row.id} className="wl-extract-row">
                <input
                  type="checkbox"
                  className="wl-extract-check"
                  checked={row.checked}
                  aria-label={`accept ${descriptor.value}`}
                  onChange={() => toggleRow(row.id)}
                />
                <span
                  className={`wl-extract-badge wl-extract-badge-${descriptor.kind}`}
                >
                  {descriptor.badge}
                </span>
                <span className="wl-extract-value" title={descriptor.value}>
                  {descriptor.value}
                </span>
                <span
                  className="wl-extract-confidence"
                  title={`confidence ${percent}%`}
                >
                  <span className="wl-extract-bar">
                    <span
                      className="wl-extract-bar-fill"
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                  <span className="wl-extract-percent">{percent}%</span>
                </span>
                <button
                  type="button"
                  className="wl-extract-dismiss"
                  title="Dismiss — never re-propose this"
                  aria-label={`dismiss ${descriptor.value}`}
                  onClick={() => dismissRow(row)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {rows.length === 0 && !running && !applied && (
        <p className="wl-empty">No pending proposals — run extraction on this note.</p>
      )}

      {rows.length > 0 && (
        <div className="wl-extract-actions">
          <button
            type="button"
            className="wl-btn"
            disabled={busy || checkedCount === 0}
            title={checkedCount === 0 ? "Check a proposal to accept it." : undefined}
            onClick={() => void acceptSelected()}
          >
            {busy ? "Saving…" : `Accept selected (${checkedCount})`}
          </button>
          <button
            type="button"
            className="wl-btn wl-btn-ghost"
            disabled={busy}
            onClick={dismissAll}
          >
            Dismiss all
          </button>
        </div>
      )}
    </section>
  );
}
