/**
 * M2 Wave E1 — proposal-row presentation logic (PLAN-M2 §E1).
 *
 * Pure, React-free so it is unit-testable under the node vitest env; the
 * ExtractionPanel component is a thin shell over these functions.
 */
import type { ExtractionProposal } from "../core/ai/extract";
import { proposalHash } from "../core/ai/accept-extract";

/** Rows with confidence >= this ship pre-checked (PRD-M2 §3). */
export const AUTO_ACCEPT_CONFIDENCE = 0.7;

export interface ProposalRow {
  /** Unique React key (hash, with an occurrence suffix for repeats). */
  id: string;
  /** Tombstone key — survives re-extraction with different confidence. */
  hash: string;
  proposal: ExtractionProposal;
  /** Accept checkbox state (default: confidence >= AUTO_ACCEPT_CONFIDENCE). */
  checked: boolean;
}

type DismissedLookup = Pick<ReadonlySet<string>, "has">;

const NO_DISMISSED: DismissedLookup = { has: () => false };

/**
 * Builds render rows from a fresh proposal list: tombstoned proposals are
 * suppressed, remaining rows default their checkbox from the confidence.
 */
export function buildProposalRows(
  proposals: readonly ExtractionProposal[],
  dismissed: DismissedLookup = NO_DISMISSED,
): ProposalRow[] {
  const rows: ProposalRow[] = [];
  const seenIds = new Set<string>();
  for (const proposal of proposals) {
    const hash = proposalHash(proposal);
    if (dismissed.has(hash)) continue;
    let id = hash;
    for (let n = 1; seenIds.has(id); n++) id = `${hash}-${n}`;
    seenIds.add(id);
    rows.push({
      id,
      hash,
      proposal,
      checked: proposal.confidence >= AUTO_ACCEPT_CONFIDENCE,
    });
  }
  return rows;
}

/** Flags parallel to `applyProposalsToSource`'s proposals array. */
export function acceptedFlagsFor(rows: readonly ProposalRow[]): boolean[] {
  return rows.map((row) => row.checked);
}

export interface ProposalDescriptor {
  kind: "entity" | "alias" | "relation";
  /** Short badge text. */
  badge: string;
  /** Human-readable row value. */
  value: string;
  confidence: number;
}

export function describeProposal(proposal: ExtractionProposal): ProposalDescriptor {
  const confidence = Math.min(1, Math.max(0, proposal.confidence));
  switch (proposal.kind) {
    case "entity":
      return {
        kind: "entity",
        badge: "entity",
        value: `${proposal.name} → ${proposal.entityType}`,
        confidence,
      };
    case "alias":
      return { kind: "alias", badge: "alias", value: proposal.alias, confidence };
    case "relation":
      return {
        kind: "relation",
        badge: "relation",
        value: `${proposal.relationKind} → ${proposal.target}`,
        confidence,
      };
  }
}
