/**
 * Structured extraction (PLAN-M2 B2): note → prompt → validated proposal list.
 *
 * Strict by contract: raw model output is untrusted. `parseExtractionResponse`
 * NEVER throws — every malformed shape (non-JSON, wrong root, bad entry,
 * oversized payload) comes back as a typed `ExtractionParseError`.
 */

import type { Note, Relation } from "../types";
import {
  extractionV1,
  toChatMessages,
  type ExtractionInput,
} from "./prompts";
import type { ChatMessage } from "./types";

/** Minimal note view the extraction prompt needs. */
export type ExtractionNoteInput = ExtractionInput;

/** Builds the system + user turns for extracting one note. */
export function buildExtractionMessages(
  note: ExtractionNoteInput,
): ChatMessage[] {
  return toChatMessages(extractionV1, note);
}

// ---------------------------------------------------------------------------
// Token estimation (tiktoken-free heuristic: chars/4 + per-message overhead)
// ---------------------------------------------------------------------------

/** Formatting overhead charged per message on top of content tokens. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** Rough token count for a string: ceil(chars / 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Rough token count for a chat request: per-message overhead + content. */
export function estimateMessageTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (total, message) => total + MESSAGE_OVERHEAD_TOKENS + estimateTokens(message.content),
    0,
  );
}

// ---------------------------------------------------------------------------
// Proposal model
// ---------------------------------------------------------------------------

export interface EntityProposal {
  kind: "entity";
  /** Note name the entity proposal refers to. */
  name: string;
  /** Proposed frontmatter `type` (character, place, event, …). */
  entityType: string;
  confidence: number;
}

export interface AliasProposal {
  kind: "alias";
  /** Alternative name to add to the note's frontmatter `aliases`. */
  alias: string;
  confidence: number;
}

export interface RelationProposal {
  kind: "relation";
  /** snake_case relation kind (frontmatter `relations[].kind`). */
  relationKind: string;
  /** Target note name (frontmatter `relations[].target`). */
  target: string;
  confidence: number;
}

export type ExtractionProposal =
  | EntityProposal
  | AliasProposal
  | RelationProposal;

export type ExtractionErrorKind =
  | "oversized" // response exceeded the size cap; not parsed at all
  | "not-json" // no JSON document could be located in the text
  | "invalid-shape" // valid JSON, wrong root shape (not array/proposals)
  | "invalid-entry"; // one entry failed validation; entryIndex points at it

/** Typed, never-thrown failure from `parseExtractionResponse`. */
export class ExtractionParseError extends Error {
  readonly kind: ExtractionErrorKind;
  /** Index of the offending entry, only for `invalid-entry`. */
  readonly entryIndex?: number;

  constructor(
    kind: ExtractionErrorKind,
    message: string,
    entryIndex?: number,
  ) {
    super(message);
    this.name = "ExtractionParseError";
    this.kind = kind;
    this.entryIndex = entryIndex;
  }
}

export interface ParseExtractionOptions {
  /** Hard cap on raw response length; larger payloads fail as "oversized". */
  maxChars?: number;
}

/** Default size cap for one extraction response (~25k tokens). */
export const DEFAULT_MAX_EXTRACTION_CHARS = 100_000;

export type ExtractionParseResult =
  | {
      ok: true;
      proposals: ExtractionProposal[];
      /** Proposals dropped because they duplicated each other or the note. */
      droppedDuplicates: number;
    }
  | { ok: false; error: ExtractionParseError };

// ---------------------------------------------------------------------------
// Strict parser
// ---------------------------------------------------------------------------

const PROPOSAL_KINDS = new Set(["entity", "alias", "relation"]);

/** Models fence JSON anyway; take the first fenced block if one exists. */
const FENCE_RE = /```[A-Za-z]*[ \t]*\r?\n?([\s\S]*?)```/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  entry: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const value = entry[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ExtractionParseError(
      "invalid-entry",
      `Entry ${index}: "${field}" must be a non-empty string`,
      index,
    );
  }
  return value.trim();
}

function confidenceOf(
  entry: Record<string, unknown>,
  index: number,
): number {
  const value = entry["confidence"];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ExtractionParseError(
      "invalid-entry",
      `Entry ${index}: "confidence" must be a finite number between 0 and 1`,
      index,
    );
  }
  return Math.min(1, Math.max(0, value));
}

function validateEntry(entry: unknown, index: number): ExtractionProposal {
  if (!isRecord(entry)) {
    throw new ExtractionParseError(
      "invalid-entry",
      `Entry ${index}: must be a JSON object`,
      index,
    );
  }
  const kind = entry["kind"];
  if (typeof kind !== "string" || !PROPOSAL_KINDS.has(kind.trim())) {
    throw new ExtractionParseError(
      "invalid-entry",
      `Entry ${index}: unknown proposal kind ${JSON.stringify(kind)}`,
      index,
    );
  }
  const confidence = confidenceOf(entry, index);
  switch (kind.trim()) {
    case "entity":
      return {
        kind: "entity",
        name: requiredString(entry, "name", index),
        entityType: requiredString(entry, "entityType", index),
        confidence,
      };
    case "alias":
      return {
        kind: "alias",
        alias: requiredString(entry, "alias", index),
        confidence,
      };
    default:
      return {
        kind: "relation",
        relationKind: requiredString(entry, "relationKind", index),
        target: requiredString(entry, "target", index),
        confidence,
      };
  }
}

function dedupeKey(proposal: ExtractionProposal): string {
  switch (proposal.kind) {
    case "entity":
      return `entity|${proposal.entityType.toLowerCase()}`;
    case "alias":
      return `alias|${proposal.alias.toLowerCase()}`;
    case "relation":
      return `relation|${proposal.relationKind.toLowerCase()}|${proposal.target.toLowerCase()}`;
  }
}

/** Collapses within-list duplicates; the highest confidence wins. */
function collapseDuplicates(
  proposals: ExtractionProposal[],
): { unique: ExtractionProposal[]; dropped: number } {
  const unique: ExtractionProposal[] = [];
  const byKey = new Map<string, number>();
  for (const proposal of proposals) {
    const key = dedupeKey(proposal);
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, unique.length);
      unique.push(proposal);
      continue;
    }
    if (proposal.confidence > unique[existingIndex].confidence) {
      unique[existingIndex] = proposal;
    }
  }
  return { unique, dropped: proposals.length - unique.length };
}

/**
 * Parses raw model output into a validated proposal list.
 *
 * Accepts `{"proposals": [...]}`, a bare top-level array, and either wrapped
 * in a markdown code fence. Anything else is a typed error — never a throw.
 */
export function parseExtractionResponse(
  raw: string,
  options: ParseExtractionOptions = {},
): ExtractionParseResult {
  const maxChars = options.maxChars ?? DEFAULT_MAX_EXTRACTION_CHARS;
  try {
    if (typeof raw !== "string") {
      return {
        ok: false,
        error: new ExtractionParseError(
          "invalid-shape",
          "Model response is not a string",
        ),
      };
    }
    if (raw.length > maxChars) {
      return {
        ok: false,
        error: new ExtractionParseError(
          "oversized",
          `Model response of ${raw.length} chars exceeds the ${maxChars} char cap`,
        ),
      };
    }

    const fenced = FENCE_RE.exec(raw);
    const candidate = (fenced?.[1] ?? raw).trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch (cause) {
      return {
        ok: false,
        error: new ExtractionParseError(
          "not-json",
          `Model response is not valid JSON: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        ),
      };
    }

    let entries: unknown[];
    if (Array.isArray(parsed)) {
      entries = parsed;
    } else if (isRecord(parsed) && Array.isArray(parsed["proposals"])) {
      entries = parsed["proposals"];
    } else {
      return {
        ok: false,
        error: new ExtractionParseError(
          "invalid-shape",
          'Model JSON must be an array or an object with a "proposals" array',
        ),
      };
    }

    const validated = entries.map((entry, index) =>
      validateEntry(entry, index),
    );
    const { unique, dropped } = collapseDuplicates(validated);
    return { ok: true, proposals: unique, droppedDuplicates: dropped };
  } catch (cause) {
    // Never-throws guarantee: typed entry errors pass through untouched;
    // anything unexpected surfaces as a typed error too.
    if (cause instanceof ExtractionParseError) {
      return { ok: false, error: cause };
    }
    return {
      ok: false,
      error: new ExtractionParseError(
        "invalid-shape",
        `Unexpected parser failure: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// Frontmatter dedupe (note → proposals)
// ---------------------------------------------------------------------------

function lower(value: string): string {
  return value.toLowerCase();
}

function isRedundant(
  proposal: ExtractionProposal,
  note: Pick<Note, "title" | "type" | "aliases" | "relations">,
): boolean {
  switch (proposal.kind) {
    case "entity":
      return (
        note.type !== undefined &&
        lower(note.type) === lower(proposal.entityType)
      );
    case "alias":
      return (
        note.aliases.some((alias) => lower(alias) === lower(proposal.alias)) ||
        lower(note.title) === lower(proposal.alias)
      );
    case "relation":
      return note.relations.some(
        (relation: Relation) =>
          lower(relation.kind) === lower(proposal.relationKind) &&
          lower(relation.target) === lower(proposal.target),
      );
  }
}

/**
 * Parses one note's model response and drops proposals the note's existing
 * frontmatter already carries (case-insensitive), plus the note title itself
 * as a redundant alias. Returns a typed error for malformed output.
 */
export function extractProposals(
  note: Pick<Note, "title" | "type" | "aliases" | "relations">,
  raw: string,
  options: ParseExtractionOptions = {},
): ExtractionParseResult {
  const result = parseExtractionResponse(raw, options);
  if (!result.ok) return result;

  const kept = result.proposals.filter(
    (proposal) => !isRedundant(proposal, note),
  );
  return {
    ok: true,
    proposals: kept,
    droppedDuplicates:
      result.droppedDuplicates + (result.proposals.length - kept.length),
  };
}
