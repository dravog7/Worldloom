/**
 * M2 Wave D2 (PLAN-M2): findings presentation logic — the pure half of the
 * Findings panel. Everything here is deterministic, Tauri-free, network-free
 * (ARCH.md pure-core); the React panel is a thin shell over these functions.
 *
 * Three concerns:
 * 1. Ordering/grouping — display severity (llm-contradiction > duplicate-alias
 *    > missing-relation-target > temporal-overlap > dead-link), then noteA
 *    path, then the rules.ts canonical tiebreaks. Grouping is by noteA (the
 *    finding's home note); the B-side note stays reachable through the second
 *    clickable quote, so a two-note finding never needs to be duplicated.
 * 2. Panel model — buildFindingRows derives the rendered tree from findings +
 *    tombstone state (dismissed ids suppressed) + the expanded-group set. The
 *    panel re-derives after every audit/dismiss (refresh counter), so a
 *    dismissed row disappears without any local hide-list trickery.
 * 3. Pre-run cost estimate — planAuditPass replays the EXACT batching and
 *    token accounting llmAudit will use (selectAuditContext + the frozen
 *    audit-v1 prompt + estimateMessageTokens), and estimateAuditCost turns
 *    that plan into USD using the user's cost table (settings.ts math).
 *    The rules pass is offline and always free; only LLM batches cost money.
 */
import { estimateMessageTokens } from "../ai/extract";
import { auditV1, toChatMessages } from "../ai/prompts";
import { aiCapability } from "../ai/capability";
import { estimateCostUsd, type AiSettings } from "../ai/settings";
import type { Note } from "../types";
import {
  DEFAULT_AUDIT_BATCH_TOKENS,
  isDismissed,
  selectAuditContext,
  type AuditState,
} from "./llm";
import type { AuditFinding, LlmFinding } from "./llm";
import type { Finding } from "./rules";

/* ------------------------------------------------------------------ */
/* 1. Severity ordering + grouping                                     */
/* ------------------------------------------------------------------ */

/** Every finding kind the panel can render (rules + LLM vocabulary). */
export type AuditFindingKind = Finding["kind"] | LlmFinding["kind"];

/** Display severity, highest first (PLAN-M2 D2). Frozen order. */
export const SEVERITY_ORDER: readonly AuditFindingKind[] = [
  "llm-contradiction",
  "duplicate-alias",
  "missing-relation-target",
  "temporal-overlap",
  "dead-link",
];

const SEVERITY_RANK: Record<AuditFindingKind, number> = (() => {
  const rank = {} as Record<AuditFindingKind, number>;
  SEVERITY_ORDER.forEach((kind, index) => {
    rank[kind] = index;
  });
  return rank;
})();

/** Badge label per kind (readable, not the raw kebab tag). */
export const KIND_LABELS: Record<AuditFindingKind, string> = {
  "llm-contradiction": "AI contradiction",
  "duplicate-alias": "duplicate alias",
  "missing-relation-target": "missing relation target",
  "temporal-overlap": "temporal overlap",
  "dead-link": "dead wikilink",
};

/** Unknown kinds sort last (defensive; the vocabulary is closed today). */
export function severityRank(kind: AuditFindingKind): number {
  return SEVERITY_RANK[kind] ?? SEVERITY_ORDER.length;
}

/** Pure: severity → noteA → lineA → noteB → id. Input array untouched. */
export function sortFindings(findings: readonly AuditFinding[]): AuditFinding[] {
  return [...findings].sort(
    (a, b) =>
      severityRank(a.kind) - severityRank(b.kind) ||
      cmp(a.noteA, b.noteA) ||
      a.lineA - b.lineA ||
      cmp(a.noteB ?? "", b.noteB ?? "") ||
      cmp(a.id, b.id),
  );
}

export interface FindingGroup {
  /** Home note (noteA). The B side is one clickable quote away. */
  path: string;
  findings: AuditFinding[];
}

/** Findings grouped by noteA; groups path-sorted, findings severity-sorted. */
export function groupFindingsByNote(findings: readonly AuditFinding[]): FindingGroup[] {
  const byPath = new Map<string, AuditFinding[]>();
  for (const finding of sortFindings(findings)) {
    const list = byPath.get(finding.noteA);
    if (list) list.push(finding);
    else byPath.set(finding.noteA, [finding]);
  }
  return [...byPath.entries()]
    .sort((a, b) => cmp(a[0], b[0]))
    .map(([path, list]) => ({ path, findings: list }));
}

/* ------------------------------------------------------------------ */
/* 2. Panel model                                                      */
/* ------------------------------------------------------------------ */

/** One clickable piece of evidence: opens note@line and reveals the quote. */
export interface QuoteRef {
  side: "A" | "B";
  note: string;
  /** 0-based line; -1 = frontmatter finding (no source line in the index). */
  line: number;
  /** Verbatim quote (rules) or the exact offending token (wikilink/target). */
  quote: string;
}

export interface FindingRow {
  id: string;
  kind: AuditFindingKind;
  kindLabel: string;
  message: string;
  /** One quote ref for single-note findings, two for contradictions. */
  quotes: QuoteRef[];
}

export interface FindingGroupRow {
  path: string;
  expanded: boolean;
  findings: FindingRow[];
}

export interface FindingsViewState {
  auditState: AuditState;
  expanded: ReadonlySet<string>;
}

/** Quote refs for one finding: A always, B when the finding has two sides. */
export function findingQuotes(finding: AuditFinding): QuoteRef[] {
  const quotes: QuoteRef[] = [
    { side: "A", note: finding.noteA, line: finding.lineA, quote: finding.quoteA },
  ];
  if (finding.noteB !== undefined && finding.quoteB !== undefined) {
    quotes.push({ side: "B", note: finding.noteB, line: finding.lineB ?? -1, quote: finding.quoteB });
  }
  return quotes;
}

/**
 * Findings → the tree the panel renders: dismissed ids suppressed (the
 * tombstone filter after merge), grouped by note, collapse state applied.
 */
export function buildFindingRows(
  findings: readonly AuditFinding[],
  state: FindingsViewState,
): FindingGroupRow[] {
  const visible = findings.filter((finding) => !isDismissed(state.auditState, finding.id));
  return groupFindingsByNote(visible).map((group) => ({
    path: group.path,
    expanded: state.expanded.has(group.path),
    findings: group.findings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      kindLabel: KIND_LABELS[finding.kind] ?? finding.kind,
      message: finding.message,
      quotes: findingQuotes(finding),
    })),
  }));
}

/* ------------------------------------------------------------------ */
/* 3. Pre-run plan + cost estimate                                     */
/* ------------------------------------------------------------------ */

/** What the LLM pass would send, computed BEFORE the user confirms spend. */
export interface AuditPassPlan {
  /** Notes never audited, or audited at a different mtime (incremental). */
  pendingNotes: Note[];
  /** Prompt batches selectAuditContext would send for those notes. */
  batches: number;
  /** Estimated input tokens across all batches (system + user turns). */
  totalInputTokens: number;
  /** Average input tokens per batch; 0 when there are no batches. */
  tokensPerBatch: number;
}

/** Notes the LLM pass would (re)send: mtime changed or never audited. */
export function pendingAuditNotes(
  notes: readonly Note[],
  state: AuditState,
): Note[] {
  return notes.filter((note) => state.lastAudit[note.path] !== note.mtime);
}

/**
 * Replays the audit's own batching + token accounting (same estimator, same
 * frozen audit-v1 prompt, system turn charged per batch — llm.ts contract),
 * so the estimate cannot drift from what runLlmAudit will actually send.
 */
export function planAuditPass(
  notes: readonly Note[],
  state: AuditState,
  budgetTokens: number = DEFAULT_AUDIT_BATCH_TOKENS,
): AuditPassPlan {
  const pendingNotes = pendingAuditNotes(notes, state);
  const batches = selectAuditContext(pendingNotes, budgetTokens);
  const totalInputTokens = batches.reduce(
    (sum, batch) => sum + estimateMessageTokens(toChatMessages(auditV1, { notes: batch })),
    0,
  );
  return {
    pendingNotes,
    batches: batches.length,
    totalInputTokens,
    tokensPerBatch: batches.length === 0 ? 0 : totalInputTokens / batches.length,
  };
}

/**
 * Per-batch OUTPUT token allowance for the audit-v1 JSON reply. A cap, not a
 * prediction: models answer "no findings" in a few tokens, but a chatty batch
 * must not make the confirm dialog understate the spend.
 */
export const AUDIT_OUTPUT_TOKENS_PER_BATCH = 1_000;

export interface AuditCostOptions {
  /** USD per 1M input tokens (user's cost table, settings.ts). */
  priceInputPerM: number;
  /** USD per 1M output tokens. */
  priceOutputPerM: number;
  /** Planned average input tokens per batch (planAuditPass.tokensPerBatch). */
  tokensPerBatch: number;
}

export interface AuditCostEstimate {
  /** USD for the LLM input tokens of the whole pass. */
  inputUsd: number;
  /** input + the output allowance — the number the confirm dialog shows. */
  totalUsd: number;
}

function toCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Plan → USD. The rules pass is offline and free, so it contributes nothing;
 * `rulesNoteCount` guards the plan instead: a batch holds ≥1 note, so the
 * batch count can never exceed the note count — the clamp kills runaway
 * estimates from a stale plan (e.g. notes deleted between plan and confirm).
 * Garbage inputs (NaN, negatives, infinite prices) read as zero, never NaN.
 */
export function estimateAuditCost(
  rulesNoteCount: number,
  llmBatchCount: number,
  options: AuditCostOptions,
): AuditCostEstimate {
  const batchCount = Math.min(toCount(llmBatchCount), toCount(rulesNoteCount));
  const inputTokens = batchCount * toCount(options.tokensPerBatch);
  const inputUsd = estimateCostUsd(inputTokens, options.priceInputPerM);
  const outputUsd = estimateCostUsd(
    batchCount * AUDIT_OUTPUT_TOKENS_PER_BATCH,
    options.priceOutputPerM,
  );
  return { inputUsd, totalUsd: inputUsd + outputUsd };
}

/** Compact USD display for the confirm dialog (cent-scale costs). */
export function formatUsd(value: number): string {
  return `$${toCount(value).toFixed(4)}`;
}

/* ------------------------------------------------------------------ */
/* Capability gate (LLM pass on/off)                                   */
/* ------------------------------------------------------------------ */

export interface LlmGate {
  configured: boolean;
  /** One-line panel note when not configured; null when ready. */
  note: string | null;
}

/**
 * Wraps core/ai/capability's aiCapability for the panel: a missing key (the
 * common case) gets the exact PLAN-M2 D2 copy; other blockers name themselves.
 * Key status null fails closed — outside Tauri we never claim readiness.
 */
export function llmAuditGate(
  aiSettings: AiSettings,
  keyPresent: boolean | null,
): LlmGate {
  const capability = aiCapability({ aiSettings, keyPresent });
  if (capability.configured) return { configured: true, note: null };
  const keyMissing = capability.reasons.includes("no API key stored");
  return {
    configured: false,
    note: keyMissing
      ? "LLM pass needs an API key — rules pass still works"
      : `LLM pass unavailable (${capability.reasons.join(", ")}) — rules pass still works`,
  };
}

/** Locale-independent codepoint comparison (hash/order stability). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
