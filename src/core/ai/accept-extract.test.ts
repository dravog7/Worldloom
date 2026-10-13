import { describe, expect, it } from "vitest";
import { parseNote } from "../parser";
import type { ExtractionProposal } from "./extract";
import {
  applyProposalsToSource,
  filterDismissed,
  isProposalDismissed,
  proposalHash,
  provenanceComment,
  stripProvenance,
} from "./accept-extract";

/**
 * M2 Wave E1 — accept-extract merge tests (PLAN-M2 §E1).
 *
 * Pure string-in/string-out: the rewrite must preserve the body byte-for-byte,
 * round-trip the M1 parser with the merged values, and never stack more than
 * one provenance comment across repeated accept runs.
 */

const FIXED_NOW = () => new Date("2026-10-13T10:00:00.000Z");

const SOURCE = [
  "---",
  "type: place",
  "aliases:",
  "  - Old Vael",
  "tags: [homebrew]",
  "relations:",
  "  - kind: located_in",
  "    target: Shattered Coast",
  "---",
  "",
  "# Vael'Thor",
  "",
  "The spire of  Vael'Thor guards the coast.",
  "",
].join("\n");

const PATH = "places/Vael'Thor.md";

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
const relation = (relationKind: string, target: string, confidence: number): ExtractionProposal => ({
  kind: "relation",
  relationKind,
  target,
  confidence,
});

function accept(
  proposals: readonly ExtractionProposal[],
  flags: ReadonlyArray<boolean>,
  options: Parameters<typeof applyProposalsToSource>[3] = {},
): string {
  return applyProposalsToSource({ path: PATH, source: SOURCE }, proposals, flags, {
    now: FIXED_NOW,
    ...options,
  });
}

describe("applyProposalsToSource — aliases", () => {
  it("unions accepted aliases with existing ones, no duplicates (case-insensitive)", () => {
    const out = accept(
      [alias("Vael Spire", 0.9), alias("old vael", 0.95), alias("New Name", 0.6)],
      [true, true, true],
    );
    const parsed = parseNote(PATH, out);
    expect(parsed.aliases).toEqual(["Old Vael", "Vael Spire", "New Name"]);
  });

  it("never adds an alias that duplicates the note title", () => {
    const out = accept([alias("Vael'Thor", 0.9), alias("vael'thor spire", 0.7)], [true, true]);
    const parsed = parseNote(PATH, out);
    expect(parsed.aliases).toEqual(["Old Vael", "vael'thor spire"]);
  });

  it("only accepted proposals are applied (flags are authoritative)", () => {
    const out = accept(
      [alias("Accepted", 0.9), alias("Rejected", 0.9)],
      [true, false],
    );
    const parsed = parseNote(PATH, out);
    expect(parsed.aliases).toEqual(["Old Vael", "Accepted"]);
  });

  it("a shorter flags array means the missing slots are NOT accepted", () => {
    const out = accept([alias("First", 0.9), alias("Second", 0.9)], [true]);
    const parsed = parseNote(PATH, out);
    expect(parsed.aliases).toEqual(["Old Vael", "First"]);
  });
});

describe("applyProposalsToSource — relations", () => {
  it("unions accepted relations with existing ones, deduped by kind+target", () => {
    const out = accept(
      [
        relation("betrayed", "Mira", 0.9),
        relation("located_in", "shattered coast", 0.95), // dup of existing, other case
        relation("located_in", "Mira", 0.4), // accepted but low confidence — still applied
      ],
      [true, true, true],
    );
    const parsed = parseNote(PATH, out);
    expect(parsed.relations).toEqual([
      { kind: "located_in", target: "Shattered Coast" },
      { kind: "betrayed", target: "Mira" },
      { kind: "located_in", target: "Mira" },
    ]);
  });
});

describe("applyProposalsToSource — type", () => {
  it("fills type only when the note has none", () => {
    const bare = "---\naliases: [X]\n---\n# Bare\n\nbody\n";
    const out = applyProposalsToSource(
      { path: "bare.md", source: bare },
      [entity("Bare", "faction", 0.8)],
      [true],
      { now: FIXED_NOW },
    );
    expect(parseNote("bare.md", out).type).toBe("faction");
  });

  it("never overwrites an existing type without the override flag", () => {
    const out = accept([entity("Vael'Thor", "region", 0.9)], [true]);
    expect(parseNote(PATH, out).type).toBe("place");
  });

  it("overrideType: true lets an accepted entity proposal replace the type", () => {
    const out = accept([entity("Vael'Thor", "region", 0.9)], [true], { overrideType: true });
    expect(parseNote(PATH, out).type).toBe("region");
  });
});

describe("applyProposalsToSource — provenance comment", () => {
  it("appends exactly one wl:extracted comment with iso timestamp + max confidence", () => {
    const out = accept([alias("Vael Spire", 0.6), relation("betrayed", "Mira", 0.95)], [true, true]);
    const matches = out.match(/<!-- wl:extracted/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(out).toContain("<!-- wl:extracted 2026-10-13T10:00:00.000Z confidence=0.95 -->");
  });

  it("a second accept run replaces the previous comment — never stacks", () => {
    const first = accept([alias("One", 0.8)], [true]);
    const second = applyProposalsToSource(
      { path: PATH, source: first },
      [alias("Two", 0.7)],
      [true],
      { now: () => new Date("2026-10-14T12:30:00.000Z") },
    );
    const matches = second.match(/<!-- wl:extracted/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(second).toContain("confidence=0.70");
    expect(second).not.toContain("2026-10-13T10:00:00.000Z");
    expect(second).toContain("One"); // the earlier alias survives in frontmatter
    expect(parseNote(PATH, second).aliases).toEqual(["Old Vael", "One", "Two"]);
  });

  it("provenanceComment renders the frozen format", () => {
    expect(provenanceComment(0.8, new Date("2026-01-02T03:04:05.000Z"))).toBe(
      "<!-- wl:extracted 2026-01-02T03:04:05.000Z confidence=0.80 -->",
    );
  });
});

describe("applyProposalsToSource — body preservation & round-trip", () => {
  it("preserves the body byte-for-byte (double spaces, blank lines)", () => {
    const originalBody = parseNote(PATH, SOURCE).body;
    const out = accept([alias("Vael Spire", 0.9)], [true]);
    const newBody = parseNote(PATH, out).body;
    expect(newBody.startsWith(originalBody)).toBe(true);
    expect(stripProvenance(newBody)).toBe(originalBody);
  });

  it("preserves a CRLF body byte-for-byte", () => {
    const crlf = "---\r\ntype: place\r\n---\r\nline one\r\n\r\nline  two\r\n";
    const originalBody = parseNote("crlf.md", crlf).body;
    const out = applyProposalsToSource(
      { path: "crlf.md", source: crlf },
      [alias("C", 0.9)],
      [true],
      { now: FIXED_NOW },
    );
    expect(stripProvenance(parseNote("crlf.md", out).body)).toBe(originalBody);
  });

  it("round-trips the M1 parser with the new values merged in", () => {
    const out = accept(
      [entity("Vael'Thor", "fortress", 0.85), alias("Spire", 0.9), relation("betrayed", "Mira", 0.8)],
      [true, true, true],
    );
    const parsed = parseNote(PATH, out);
    expect(parsed.type).toBe("place"); // filled-only rule: existing type wins
    expect(parsed.title).toBe("Vael'Thor");
    expect(parsed.aliases).toContain("Spire");
    expect(parsed.relations).toContainEqual({ kind: "betrayed", target: "Mira" });
    expect(parsed.tags).toEqual(["homebrew"]); // untouched frontmatter keys survive
    expect(out).toContain("homebrew");
  });

  it("a frontmatter-less note gains frontmatter without touching the body", () => {
    const bare = "# Bare\n\nSome  body.\n";
    const out = applyProposalsToSource(
      { path: "bare.md", source: bare },
      [alias("Baring", 0.9)],
      [true],
      { now: FIXED_NOW },
    );
    const parsed = parseNote("bare.md", out);
    expect(parsed.aliases).toEqual(["Baring"]);
    expect(stripProvenance(parsed.body)).toBe(parseNote("bare.md", bare).body);
  });
});

describe("applyProposalsToSource — degenerate inputs", () => {
  it("nothing accepted → the source string comes back untouched", () => {
    const out = accept([alias("Nope", 0.9)], [false]);
    expect(out).toBe(SOURCE);
  });

  it("garbage proposals never crash Accept — malformed entries are skipped", () => {
    const garbage = [
      null,
      42,
      "alias",
      { kind: "alias" },
      { kind: "alias", alias: "   ", confidence: 0.9 },
      { kind: "entity", name: "X" },
      { kind: "relation", relationKind: "knows" },
      { kind: "weird", alias: "Zombie", confidence: 0.9 },
      { kind: "alias", alias: "Ok Alias", confidence: "high" },
      { kind: "alias", alias: "Survivor", confidence: 0.8 },
    ] as unknown as ExtractionProposal[];
    const out = accept(garbage, new Array(garbage.length).fill(true));
    const parsed = parseNote(PATH, out);
    expect(parsed.aliases).toEqual(["Old Vael", "Survivor"]); // "high" confidence is malformed → skipped
  });

  it("malformed YAML frontmatter is left byte-identical (unsafe to rewrite)", () => {
    const broken = "---\ntype: [unclosed\n---\nbody text\n";
    const out = applyProposalsToSource(
      { path: "broken.md", source: broken },
      [alias("X", 0.9)],
      [true],
      { now: FIXED_NOW },
    );
    expect(out).toBe(broken);
  });

  it("non-array proposals/flags inputs degrade to a no-op, not a throw", () => {
    const out = applyProposalsToSource(
      { path: PATH, source: SOURCE },
      undefined as unknown as ExtractionProposal[],
      undefined as unknown as boolean[],
      { now: FIXED_NOW },
    );
    expect(out).toBe(SOURCE);
  });
});

describe("tombstones — proposalHash / isProposalDismissed", () => {
  it("hash is stable and case-insensitive on the proposal values", () => {
    expect(proposalHash(alias("Vael Spire", 0.9))).toBe(proposalHash(alias("vael spire", 0.1)));
    expect(proposalHash(entity("A", "place", 0.9))).not.toBe(proposalHash(entity("B", "place", 0.9)));
    expect(proposalHash(entity("A", "place", 0.9))).not.toBe(
      proposalHash(relation("place", "A", 0.9)),
    );
    expect(proposalHash(alias("Vael Spire", 0.9))).not.toBe(proposalHash(alias("Other", 0.9)));
    // Confidence is deliberately excluded: re-extraction with new confidence
    // must still hit the tombstone.
    expect(proposalHash(relation("betrayed", "Mira", 0.5))).toBe(
      proposalHash(relation("betrayed", "Mira", 0.99)),
    );
  });

  it("isProposalDismissed filters by hash; filterDismissed suppresses re-proposals", () => {
    const dismissed = new Set([proposalHash(alias("Vael Spire", 0.9))]);
    expect(isProposalDismissed(alias("vael spire", 0.3), dismissed)).toBe(true);
    expect(isProposalDismissed(alias("New", 0.9), dismissed)).toBe(false);
    expect(isProposalDismissed({ junk: true }, dismissed)).toBe(false);
    const kept = filterDismissed(
      [alias("Vael Spire", 0.9), alias("New", 0.9)],
      dismissed,
    );
    expect(kept.map((p) => (p.kind === "alias" ? p.alias : ""))).toEqual(["New"]);
  });
});
