/**
 * M2 Wave D1 (PLAN-M2): the LLM audit pass.
 *
 * Compares prompt-sized slices of the vault through the frozen audit-v1 prompt
 * (src/core/ai/prompts/audit-v1.ts) and turns raw model JSON into
 * contradiction findings — the SAME shape as the rules auditor (rules.ts),
 * with `kind: "llm-contradiction"` added to the finding vocabulary. Every
 * finding carries two VERBATIM quotes with their note paths and 0-based line
 * locators; the message is the model's explanation.
 *
 * Trust boundaries (ADR-004 §2, ARCH.md pure-core):
 * - The model output is untrusted DATA. `parseAuditResponse` NEVER throws:
 *   structural malformation comes back as a typed `AiError("invalid-response")`;
 *   entries that fail verification (quote not verbatim, unknown note path,
 *   self-contradiction) are dropped and counted, never guessed at.
 * - This module never writes notes and never touches the filesystem. Tombstone
 *   state I/O goes exclusively through the injected `AuditStatePort`
 *   (read/write of one JSON string); `llmAudit` itself is storage-free.
 *
 * Finding identity mirrors rules.ts `makeFinding` exactly: id =
 * contentHash(kind \0 noteA \0 quoteA \0 noteB \0 quoteB) — line numbers are
 * EXCLUDED so dismissals survive edits that merely shift lines (the same
 * tombstone-stability contract as the rules pass).
 *
 * Tombstone state (app data, e.g. `audit/<vaultHash>.json`):
 * - `dismissed[findingId]` → dismissal epoch ms; dismissed ids are suppressed
 *   across every re-audit.
 * - `lastAudit[notePath]` → the note's mtime at its last completed audit; a
 *   note is re-sent to the model only when its mtime changed (incremental
 *   audits per ADR-004 §2). Entries for vanished notes drop off on the next
 *   successful run; dismissals persist (id-keyed, harmless).
 * - `vaultHash` fingerprints the audited path SET (not mtimes) so the state
 *   file stays put across ordinary edits.
 */

import { estimateTokens } from "../ai/extract";
import { auditV1, toChatMessages, type AuditNoteInput } from "../ai/prompts";
import { AiError, type ChatRequest, type Transport } from "../ai/types";
import type { IndexProvider } from "../index/provider";
import type { Note } from "../types";
import { contentHash } from "../vault/hash";
import type { Finding } from "./rules";

/* ------------------------------------------------------------------ */
/* Finding shapes                                                       */
/* ------------------------------------------------------------------ */

/** Kind tag for every LLM-pass finding (extends the rules-only vocabulary). */
export type LlmFindingKind = "llm-contradiction";

/**
 * Same shape as rules.ts `Finding`; `noteB`/`lineB`/`quoteB` are REQUIRED —
 * a contradiction always has two sides of verbatim evidence.
 */
export type LlmFinding = Omit<Finding, "kind" | "noteB" | "lineB" | "quoteB"> & {
  kind: LlmFindingKind;
  noteB: string;
  lineB: number;
  quoteB: string;
};

/** Rules + LLM findings, as the findings panel (Wave D2) consumes them. */
export type AuditFinding = Finding | LlmFinding;

const SEPARATOR = "\u0000";

/**
 * Id construction, mirroring rules.ts `makeFinding` (not exported there):
 * contentHash of kind+notes+quotes; lines excluded so a dismissal survives
 * body edits that only shift line numbers.
 */
export function llmFindingId(
  core: Pick<LlmFinding, "kind" | "noteA" | "quoteA" | "noteB" | "quoteB">,
): string {
  return contentHash(
    [core.kind, core.noteA, core.quoteA, core.noteB, core.quoteB].join(SEPARATOR),
  );
}

/** Merges rules + LLM findings, deduping by id (first occurrence wins). */
export function mergeAuditFindings(
  rulesFindings: readonly Finding[],
  llmFindings: readonly LlmFinding[],
): AuditFinding[] {
  const merged: AuditFinding[] = [];
  const seen = new Set<string>();
  for (const finding of [...rulesFindings, ...llmFindings]) {
    if (seen.has(finding.id)) continue;
    seen.add(finding.id);
    merged.push(finding);
  }
  return merged;
}

/* ------------------------------------------------------------------ */
/* Tombstone state — pure functions over one JSON document              */
/* ------------------------------------------------------------------ */

export const AUDIT_STATE_VERSION = 1;

/** App-data tombstone state (PLAN-M2 D1). Never contains note content. */
export interface AuditState {
  version: number;
  /** Fingerprint of the audited path set (see vaultFingerprint). */
  vaultHash: string;
  /** findingId → epoch ms when the user dismissed it. */
  dismissed: Record<string, number>;
  /** notePath → note mtime at its last completed audit. */
  lastAudit: Record<string, number>;
}

/**
 * DI port for the state file — the caller owns the path (e.g.
 * `audit/<vaultHash>.json` in app data) and any fs adapter. This module only
 * ever sees these two calls; it never reads or writes notes.
 */
export interface AuditStatePort {
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
}

/** Fresh state; `vaultHash` defaults to the empty vault fingerprint "". */
export function emptyAuditState(vaultHash = ""): AuditState {
  return { version: AUDIT_STATE_VERSION, vaultHash, dismissed: {}, lastAudit: {} };
}

/** Content hash over the sorted path set — stable across ordinary edits. */
export function vaultFingerprint(notes: readonly Note[]): string {
  return contentHash([...notes].map((note) => note.path).sort(cmp).join(SEPARATOR));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, stamp] of Object.entries(value)) {
    if (typeof stamp === "number" && Number.isFinite(stamp)) out[key] = stamp;
  }
  return out;
}

/**
 * Parses stored state. NEVER throws: null/empty/garbage/wrong-version payloads
 * all come back as fresh empty state (worst case = full re-audit, then the
 * next save rewrites a clean document).
 */
export function loadAuditState(raw: string | null | undefined): AuditState {
  const fresh = emptyAuditState();
  if (typeof raw !== "string" || raw.trim() === "") return fresh;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fresh;
  }
  if (!isRecord(parsed) || parsed["version"] !== AUDIT_STATE_VERSION) return fresh;
  return {
    version: AUDIT_STATE_VERSION,
    vaultHash: typeof parsed["vaultHash"] === "string" ? parsed["vaultHash"] : "",
    dismissed: numberMap(parsed["dismissed"]),
    lastAudit: numberMap(parsed["lastAudit"]),
  };
}

function sortedRecord(record: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(record).sort(cmp)) out[key] = record[key] as number;
  return out;
}

/** Canonical JSON (sorted keys) so repeated saves are byte-identical. */
export function serializeAuditState(state: AuditState): string {
  return JSON.stringify({
    version: AUDIT_STATE_VERSION,
    vaultHash: state.vaultHash,
    dismissed: sortedRecord(state.dismissed),
    lastAudit: sortedRecord(state.lastAudit),
  });
}

/** Pure: returns a NEW state with the finding tombstoned. */
export function dismissFinding(state: AuditState, findingId: string, ts: number): AuditState {
  return { ...state, dismissed: { ...state.dismissed, [findingId]: ts } };
}

/** True when a finding id was dismissed (suppressed for all future audits). */
export function isDismissed(state: AuditState, findingId: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.dismissed, findingId);
}

/* ------------------------------------------------------------------ */
/* Context assembly — selectAuditContext                                */
/* ------------------------------------------------------------------ */

/** Default per-batch user-turn budget (PLAN-M2: ≤ 6k tokens of notes/batch). */
export const DEFAULT_AUDIT_BATCH_TOKENS = 6_000;

/** Token estimator contract; defaults to extract.ts's estimateTokens. */
export type TokenEstimator = (text: string) => number;

/**
 * Groups notes into prompt-sized batches (path-sorted for determinism),
 * charged at the exact per-note cost of its audit-v1 user-turn fragment
 * (`--- NOTE <path> (title: <title>) ---\n<body>`). A note larger than the
 * budget still gets its own batch — never dropped, never an infinite loop.
 * The frozen system turn is charged on top of every batch by the caller.
 */
export function selectAuditContext(
  notes: readonly Note[],
  budgetTokens: number = DEFAULT_AUDIT_BATCH_TOKENS,
  estimator: TokenEstimator = estimateTokens,
): AuditNoteInput[][] {
  const budget =
    Number.isFinite(budgetTokens) && budgetTokens > 0
      ? budgetTokens
      : DEFAULT_AUDIT_BATCH_TOKENS;
  const sorted = [...notes].sort((a, b) => cmp(a.path, b.path));
  const batches: AuditNoteInput[][] = [];
  let current: AuditNoteInput[] = [];
  let currentCost = 0;
  for (const note of sorted) {
    const input: AuditNoteInput = { path: note.path, title: note.title, content: note.body };
    const cost = estimator(auditV1.user({ notes: [input] }));
    if (current.length > 0 && currentCost + cost > budget) {
      batches.push(current);
      current = [];
      currentCost = 0;
    }
    current.push(input);
    currentCost += cost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/* ------------------------------------------------------------------ */
/* Strict parser — never throws, typed errors only                      */
/* ------------------------------------------------------------------ */

export interface ParseAuditOptions {
  /** Findings with model confidence below this are dropped (default 0). */
  minConfidence?: number;
  /** Hard cap on raw response length; larger payloads fail as invalid. */
  maxChars?: number;
}

/** Default size cap for one audit response (~25k tokens). */
export const DEFAULT_MAX_AUDIT_CHARS = 100_000;

export type AuditParseResult =
  | {
      ok: true;
      findings: LlmFinding[];
      /** Entries dropped: non-verbatim quotes, unknown/self note paths,
       * below-threshold confidence, or id duplicates. */
      dropped: number;
    }
  | { ok: false; error: AiError };

/** Models fence JSON anyway; take the first fenced block if one exists. */
const FENCE_RE = /```[A-Za-z]*[ \t]*\r?\n?([\s\S]*?)```/;

function invalid(message: string): { ok: false; error: AiError } {
  return { ok: false, error: new AiError("invalid-response", message) };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 0-based line of the quote's first occurrence; null = not verbatim. */
function lineOfQuote(content: string, quote: string): number | null {
  const index = content.indexOf(quote);
  if (index < 0) return null;
  let line = 0;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** Structural pass; throws AiError("invalid-response") on any violation. */
function validateEntry(
  entry: unknown,
  index: number,
): { finding: LlmFinding; confidence: number } {
  const fail = (detail: string): never => {
    throw new AiError("invalid-response", `Entry ${index}: ${detail}`);
  };
  if (!isRecord(entry)) return fail("must be a JSON object");
  const requiredString = (field: string): string => {
    const value = entry[field];
    if (typeof value !== "string" || value.trim() === "") {
      return fail(`"${field}" must be a non-empty string`);
    }
    return value;
  };
  const noteA = requiredString("noteA");
  const quoteA = requiredString("quoteA");
  const noteB = requiredString("noteB");
  const quoteB = requiredString("quoteB");
  const message = requiredString("message");
  const rawConfidence = entry["confidence"];
  let confidence = 1;
  if (rawConfidence !== undefined) {
    if (typeof rawConfidence !== "number" || !Number.isFinite(rawConfidence)) {
      return fail('"confidence" must be a finite number between 0 and 1');
    }
    confidence = Math.min(1, Math.max(0, rawConfidence));
  }
  return {
    confidence,
    finding: {
      id: llmFindingId({ kind: "llm-contradiction", noteA, quoteA, noteB, quoteB }),
      kind: "llm-contradiction",
      noteA,
      lineA: 0, // replaced by the verification pass
      quoteA,
      noteB,
      lineB: 0,
      quoteB,
      message,
    },
  };
}

function compareLlmFindings(a: LlmFinding, b: LlmFinding): number {
  return (
    cmp(a.noteA, b.noteA) ||
    a.lineA - b.lineA ||
    cmp(a.noteB, b.noteB) ||
    a.lineB - b.lineB ||
    cmp(a.id, b.id)
  );
}

/**
 * Parses raw model output into verified findings. Accepts `{"findings":[…]}`
 * or a bare array, fenced or not. Structural malformation → typed
 * `AiError("invalid-response")`; unverifiable entries are DROPPED (counted in
 * `dropped`), never repaired or guessed. Never throws.
 */
export function parseAuditResponse(
  raw: string,
  notes: readonly Note[],
  options: ParseAuditOptions = {},
): AuditParseResult {
  const maxChars = options.maxChars ?? DEFAULT_MAX_AUDIT_CHARS;
  const minConfidence = options.minConfidence ?? 0;
  try {
    if (typeof raw !== "string") {
      return invalid("Model response is not a string");
    }
    if (raw.length > maxChars) {
      return invalid(
        `Model response of ${raw.length} chars exceeds the ${maxChars} char cap`,
      );
    }
    const fenced = FENCE_RE.exec(raw);
    const candidate = (fenced?.[1] ?? raw).trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (cause) {
      return invalid(`Model response is not valid JSON: ${describe(cause)}`);
    }

    let entries: unknown[];
    if (Array.isArray(parsed)) {
      entries = parsed;
    } else if (isRecord(parsed) && Array.isArray(parsed["findings"])) {
      entries = parsed["findings"];
    } else {
      return invalid('Model JSON must be an array or an object with a "findings" array');
    }

    const bodies = new Map<string, string>();
    for (const note of notes) if (!bodies.has(note.path)) bodies.set(note.path, note.body);

    const findings: LlmFinding[] = [];
    const seenIds = new Set<string>();
    let dropped = 0;
    entries.forEach((entry, index) => {
      const { finding: candidate, confidence } = validateEntry(entry, index);
      const bodyA = bodies.get(candidate.noteA);
      const bodyB = bodies.get(candidate.noteB);
      const lineA = bodyA === undefined ? null : lineOfQuote(bodyA, candidate.quoteA);
      const lineB = bodyB === undefined ? null : lineOfQuote(bodyB, candidate.quoteB);
      if (
        candidate.noteA === candidate.noteB ||
        lineA === null ||
        lineB === null ||
        confidence < minConfidence ||
        seenIds.has(candidate.id)
      ) {
        dropped += 1;
        return;
      }
      seenIds.add(candidate.id);
      findings.push({ ...candidate, lineA, lineB });
    });

    findings.sort(compareLlmFindings);
    return { ok: true, findings, dropped };
  } catch (cause) {
    // Never-throws guarantee: typed errors pass through, anything unexpected
    // (indexing surprises, hostile getters) surfaces as a typed error too.
    if (cause instanceof AiError) return { ok: false, error: cause };
    return invalid(`Unexpected audit parser failure: ${describe(cause)}`);
  }
}

/* ------------------------------------------------------------------ */
/* llmAudit — batched transport calls + tombstone integration           */
/* ------------------------------------------------------------------ */

export interface LlmAuditOptions {
  /** OpenAI-compatible base URL forwarded to the transport. */
  baseUrl: string;
  model: string;
  /** Prior tombstone state; defaults to fresh empty state. */
  state?: AuditState;
  /** Per-batch user-turn token cap; default DEFAULT_AUDIT_BATCH_TOKENS. */
  maxBatchTokens?: number;
  /** Drop findings below this model confidence (0..1); default 0. */
  minConfidence?: number;
  /** Hard cap on one raw model response; default DEFAULT_MAX_AUDIT_CHARS. */
  maxResponseChars?: number;
  /** Sampling temperature; default 0 (stable, reproducible audits). */
  temperature?: number;
  /** Token estimator used to pack batches; default extract.ts's estimateTokens. */
  estimator?: TokenEstimator;
}

export interface LlmAuditResult {
  /** Non-dismissed contradiction findings, canonically ordered. */
  findings: LlmFinding[];
  /** Next tombstone state: lastAudit stamped for every current note. */
  state: AuditState;
  /** Notes sent to the model this run (never audited, or mtime changed). */
  auditedPaths: string[];
  /** Notes skipped because their mtime matched lastAudit. */
  skippedPaths: string[];
  /** Prompt batches actually sent. */
  batches: number;
  /** Entries dropped by the parser (unverifiable, low-confidence, dupes). */
  dropped: number;
}

function toNotes(input: IndexProvider | readonly Note[]): readonly Note[] {
  return "all" in input ? input.all() : input;
}

/**
 * Audits the vault slice for narrative contradictions. Incremental by mtime
 * (lastAudit), suppression by dismissal id. Throws the parser's typed
 * `AiError("invalid-response")` on malformed model output — after which no
 * state is written and no note is touched (state persistence is the injected
 * port's job, see runLlmAudit).
 */
export async function llmAudit(
  input: IndexProvider | readonly Note[],
  transport: Transport,
  options: LlmAuditOptions,
): Promise<LlmAuditResult> {
  const notes = [...toNotes(input)].sort((a, b) => cmp(a.path, b.path));
  const prior = options.state ?? emptyAuditState();
  const byPath = new Map<string, Note>(notes.map((note) => [note.path, note]));

  const audited: Note[] = [];
  const skippedPaths: string[] = [];
  for (const note of notes) {
    if (prior.lastAudit[note.path] === note.mtime) skippedPaths.push(note.path);
    else audited.push(note);
  }

  const batches = selectAuditContext(
    audited,
    options.maxBatchTokens ?? DEFAULT_AUDIT_BATCH_TOKENS,
    options.estimator,
  );
  const findings: LlmFinding[] = [];
  const seenIds = new Set<string>();
  let dropped = 0;

  for (const batch of batches) {
    const batchNotes: Note[] = [];
    for (const item of batch) {
      const note = byPath.get(item.path);
      if (note !== undefined) batchNotes.push(note);
    }
    const request: ChatRequest = {
      baseUrl: options.baseUrl,
      model: options.model,
      messages: toChatMessages(auditV1, { notes: batch }),
      temperature: options.temperature ?? 0,
    };
    const response = await transport.chat(request);
    const parsed = parseAuditResponse(response.content, batchNotes, {
      minConfidence: options.minConfidence,
      maxChars: options.maxResponseChars,
    });
    if (!parsed.ok) throw parsed.error;
    dropped += parsed.dropped;
    for (const finding of parsed.findings) {
      if (seenIds.has(finding.id) || isDismissed(prior, finding.id)) continue;
      seenIds.add(finding.id);
      findings.push(finding);
    }
  }

  const lastAudit: Record<string, number> = {};
  for (const note of notes) lastAudit[note.path] = note.mtime;

  return {
    findings,
    state: {
      version: AUDIT_STATE_VERSION,
      vaultHash: vaultFingerprint(notes),
      dismissed: { ...prior.dismissed },
      lastAudit,
    },
    auditedPaths: audited.map((note) => note.path),
    skippedPaths,
    batches: batches.length,
    dropped,
  };
}

/**
 * DI wrapper around llmAudit: load state from the injected port, audit, then
 * persist the updated state through the same port. On any failure (including
 * the typed invalid-response error) nothing is written.
 */
export async function runLlmAudit(
  input: IndexProvider | readonly Note[],
  transport: Transport,
  port: AuditStatePort,
  options: LlmAuditOptions,
): Promise<LlmAuditResult> {
  const raw = await port.read();
  const result = await llmAudit(input, transport, { ...options, state: loadAuditState(raw) });
  await port.write(serializeAuditState(result.state));
  return result;
}

/** Locale-independent codepoint comparison (hash/order stability). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
