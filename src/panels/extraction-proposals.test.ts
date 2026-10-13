import { describe, expect, it } from "vitest";
import type { ExtractionProposal } from "../core/ai/extract";
import { proposalHash } from "../core/ai/accept-extract";
import {
  AUTO_ACCEPT_CONFIDENCE,
  acceptedFlagsFor,
  buildProposalRows,
  describeProposal,
} from "./extraction-proposals";

/**
 * M2 Wave E1 — proposal-row presentation logic (PLAN-M2 §E1).
 * Pure functions only; the React component is a thin shell over these.
 */

const alias = (value: string, confidence: number): ExtractionProposal => ({
  kind: "alias",
  alias: value,
  confidence,
});
const entity = (name: string, entityType: string, confidence: number): ExtractionProposal => ({
  kind: "entity",
  name,
  entityType,
  confidence,
});
const relation = (kind: string, target: string, confidence: number): ExtractionProposal => ({
  kind: "relation",
  relationKind: kind,
  target,
  confidence,
});

describe("buildProposalRows", () => {
  it("defaults the checkbox on for confidence >= 0.7 and off below", () => {
    const rows = buildProposalRows([
      alias("High", AUTO_ACCEPT_CONFIDENCE),
      alias("Low", 0.69),
    ]);
    expect(rows.map((r) => r.checked)).toEqual([true, false]);
  });

  it("tombstoned (dismissed) proposals are suppressed by hash", () => {
    const dismissed = new Set([proposalHash(alias("Spire", 0.9))]);
    const rows = buildProposalRows(
      [alias("spire", 0.4), alias("Kept", 0.9)],
      dismissed,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].proposal).toEqual(alias("Kept", 0.9));
  });

  it("rows carry a stable unique id even for repeated identical proposals", () => {
    const dup = alias("Twice", 0.8);
    const rows = buildProposalRows([dup, dup]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
    expect(rows[0].hash).toBe(rows[1].hash);
  });

  it("acceptedFlagsFor mirrors the visible rows' checkboxes", () => {
    const rows = buildProposalRows([alias("A", 0.9), alias("B", 0.2)]);
    rows[1].checked = true;
    expect(acceptedFlagsFor(rows)).toEqual([true, true]);
  });
});

describe("describeProposal", () => {
  it("describes each kind for badge + row value rendering", () => {
    expect(describeProposal(entity("Vael'Thor", "place", 0.9))).toEqual({
      kind: "entity",
      badge: "entity",
      value: "Vael'Thor → place",
      confidence: 0.9,
    });
    expect(describeProposal(alias("The Spire", 0.8))).toEqual({
      kind: "alias",
      badge: "alias",
      value: "The Spire",
      confidence: 0.8,
    });
    expect(describeProposal(relation("betrayed", "Mira", 0.7))).toEqual({
      kind: "relation",
      badge: "relation",
      value: "betrayed → Mira",
      confidence: 0.7,
    });
  });
});
