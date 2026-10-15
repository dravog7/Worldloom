/**
 * M2 Wave E1 — accept extraction proposals (PLAN-M2 §E1).
 *
 * Pure markdown-in / markdown-out: merges ACCEPTED proposals into the note's
 * frontmatter (type / aliases / relations), appends ONE provenance comment
 * per accepted run, and preserves the body byte-for-byte. This module never
 * touches the filesystem — the caller passes the merged string to the
 * injected vault save (atomic write, ARCH.md).
 *
 * Reads go through the M1 parser (`parseNote`), so what we merge is exactly
 * what the app will parse back — the round-trip is by construction.
 *
 * Tombstones: a dismissed proposal is identified by `proposalHash`
 * (contentHash over a canonical, case-insensitive identity string with
 * confidence deliberately EXCLUDED, so a re-extraction with a different
 * confidence still hits the tombstone).
 */
import {
  hasFrontmatterFence,
  parseFrontmatter,
  stringifyFrontmatter,
} from "../parser/frontmatter";
import { parseNote } from "../parser";
import type { ExtractionProposal } from "./extract";
import { contentHash } from "../vault/hash";

/** The note view Accept needs: the raw source is the string we rewrite. */
export interface AcceptSourceInput {
  /** Vault-relative path (parser identity); defaults to "note.md". */
  path?: string;
  /** Raw markdown source exactly as stored on disk (frontmatter + body). */
  source: string;
}

export interface ApplyProposalsOptions {
  /**
   * Allow an accepted entity proposal to REPLACE an existing `type`.
   * Default false: entity proposals only FILL a missing type — an existing
   * human-authored type is never silently overwritten (PRD-M2 §3).
   */
  overrideType?: boolean;
  /** Clock for the provenance timestamp (injectable for tests). */
  now?: () => Date;
}

/* ------------------------------------------------------------------ *
 * Provenance comment — `<!-- wl:extracted <iso> confidence=… -->`
 * ------------------------------------------------------------------ */

export const PROVENANCE_MARKER = "wl:extracted";

export function provenanceComment(confidence: number, at: Date): string {
  return `<!-- ${PROVENANCE_MARKER} ${at.toISOString()} confidence=${confidence.toFixed(2)} -->`;
}

/** Matches a full app-generated provenance line wherever it sits in the file. */
const PROVENANCE_RE =
  /^[ \t]*<!--\s*wl:extracted\b[^>\n]*-->[ \t]*\r?\n?/gm;

/** Removes every previous provenance comment (keeps runs from stacking). */
export function stripProvenance(source: string): string {
  return source.replace(PROVENANCE_RE, "");
}

/* ------------------------------------------------------------------ *
 * Tombstones — stable proposal identity
 * ------------------------------------------------------------------ */

function lower(value: string): string {
  return value.toLowerCase();
}

/** Canonical identity string for a proposal (case-insensitive, no confidence). */
function proposalIdentity(proposal: ExtractionProposal): string {
  switch (proposal.kind) {
    case "entity":
      return ["entity", lower(proposal.name), lower(proposal.entityType)].join("\u0000");
    case "alias":
      return ["alias", lower(proposal.alias)].join("\u0000");
    case "relation":
      return [
        "relation",
        lower(proposal.relationKind),
        lower(proposal.target),
      ].join("\u0000");
  }
}

/**
 * Stable tombstone key for a proposal. Confidence is excluded on purpose:
 * re-extraction must not resurrect a dismissed proposal just because the
 * model scored it differently this time.
 */
export function proposalHash(proposal: ExtractionProposal): string {
  return contentHash(proposalIdentity(proposal));
}

/** Runtime validation mirroring the B2 parser (Accept never trusts shapes). */
function isExtractionProposal(value: unknown): value is ExtractionProposal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const confidence = record.confidence;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return false;
  }
  const nonEmpty = (field: string): boolean =>
    typeof record[field] === "string" && (record[field] as string).trim() !== "";
  switch (record.kind) {
    case "entity":
      return nonEmpty("name") && nonEmpty("entityType");
    case "alias":
      return nonEmpty("alias");
    case "relation":
      return nonEmpty("relationKind") && nonEmpty("target");
    default:
      return false;
  }
}

/** Tombstone predicate: has this proposal been dismissed before? */
export function isProposalDismissed(
  proposal: unknown,
  dismissed: Pick<ReadonlySet<string>, "has">,
): boolean {
  if (!isExtractionProposal(proposal)) return false;
  return dismissed.has(proposalHash(proposal));
}

/** Filters re-proposals the user already dismissed (PLAN-M2 §E1). */
export function filterDismissed<T>(
  proposals: readonly T[],
  dismissed: Pick<ReadonlySet<string>, "has">,
): T[] {
  return proposals.filter((proposal) => !isProposalDismissed(proposal, dismissed));
}

/* ------------------------------------------------------------------ *
 * The merge
 * ------------------------------------------------------------------ */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function appendLine(source: string, line: string): string {
  if (source === "") return `${line}\n`;
  return source.endsWith("\n") ? `${source}${line}\n` : `${source}\n${line}\n`;
}

/**
 * Merges ACCEPTED proposals into the note's markdown source and returns the
 * new source. Contract:
 *
 * - aliases/relations: union with existing values (case-insensitive dedupe);
 * - type: filled only when absent, unless `overrideType` is set;
 * - exactly one provenance comment per accepted run (old ones are replaced);
 * - the body is preserved byte-for-byte;
 * - malformed proposals and flag/proposal length mismatches are skipped —
 *   this function NEVER throws for bad input;
 * - malformed YAML frontmatter (which the M1 parser tolerates by treating
 *   the whole file as body) is left byte-identical: rewriting it would
 *   destroy the user's text.
 */
export function applyProposalsToSource(
  note: AcceptSourceInput,
  proposals: readonly ExtractionProposal[],
  acceptedFlags: ReadonlyArray<boolean>,
  options: ApplyProposalsOptions = {},
): string {
  const source = note.source;
  // Browser-safe v1 subset parser (same WHY as src/core/parser: gray-matter
  // needs Buffer, which Vite externalizes in the WebView). Fence-present +
  // parse-failed = malformed → unsafe to rewrite (see docblock); no fence at
  // all = proceed with empty data so Accept can CREATE the frontmatter.
  const parsed = parseFrontmatter(source);
  if (parsed === null && hasFrontmatterFence(source)) return source;
  const rawList: readonly unknown[] = Array.isArray(proposals) ? proposals : [];
  const flags: ReadonlyArray<unknown> = Array.isArray(acceptedFlags)
    ? acceptedFlags
    : [];
  const accepted = rawList.filter(
    (proposal, index): proposal is ExtractionProposal =>
      flags[index] === true && isExtractionProposal(proposal),
  );
  if (accepted.length === 0) return source;

  // Normalized current view, exactly as the app sees the note (M1 parser).
  const existing = parseNote(note.path ?? "note.md", source);
  const data = { ...(parsed?.data ?? {}) } as Record<string, unknown>;
  const body = stripProvenance(parsed?.body ?? source);

  // --- aliases: union, case-insensitive dedupe (title counts as taken) ---
  const aliases = [...existing.aliases];
  const seenAliases = new Set(aliases.map(lower));
  seenAliases.add(lower(existing.title));
  let aliasesChanged = false;
  for (const proposal of accepted) {
    if (proposal.kind !== "alias") continue;
    const key = lower(proposal.alias);
    if (seenAliases.has(key)) continue;
    seenAliases.add(key);
    aliases.push(proposal.alias);
    aliasesChanged = true;
  }
  if (aliasesChanged) data.aliases = aliases;

  // --- relations: union, deduped by (kind, target) case-insensitively ---
  const relations = [...existing.relations];
  const seenRelations = new Set(
    relations.map((r) => `${lower(r.kind)}|${lower(r.target)}`),
  );
  let relationsChanged = false;
  for (const proposal of accepted) {
    if (proposal.kind !== "relation") continue;
    const key = `${lower(proposal.relationKind)}|${lower(proposal.target)}`;
    if (seenRelations.has(key)) continue;
    seenRelations.add(key);
    relations.push({ kind: proposal.relationKind, target: proposal.target });
    relationsChanged = true;
  }
  if (relationsChanged) data.relations = relations;

  // --- type: fill when absent; replace only with the explicit override ---
  const entityProposal = accepted.find(
    (proposal): proposal is Extract<ExtractionProposal, { kind: "entity" }> =>
      proposal.kind === "entity",
  );
  if (entityProposal !== undefined) {
    if (existing.type === undefined) {
      data.type = entityProposal.entityType;
    } else if (
      options.overrideType === true &&
      lower(existing.type) !== lower(entityProposal.entityType)
    ) {
      data.type = entityProposal.entityType;
    }
  }

  // Re-render frontmatter (unknown keys survive the spread); body verbatim.
  // stringifyFrontmatter emits exactly `---\n…\n---\n<body>` — no trailing
  // newline is added, so the original body bytes pass through unchanged.
  const out = stringifyFrontmatter(body, data);

  const confidence = Math.max(
    ...accepted.map((proposal) => clamp01(proposal.confidence)),
  );
  const at = options.now?.() ?? new Date();
  return appendLine(out, provenanceComment(confidence, at));
}
