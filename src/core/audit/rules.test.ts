import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MemoryIndex } from "../index/memory-index";
import type { IndexProvider } from "../index/provider";
import { parseNote } from "../parser";
import type { Note } from "../types";
import { auditRules, type Finding, type FindingKind } from "./rules";

/**
 * M2 Wave B3 (PLAN-M2): offline deterministic rules auditor.
 *
 * Rules (ADR-004 §2): duplicate alias → multiple targets, relation to a
 * missing note, temporal overlap conflicts, dead wikilinks. Findings carry
 * a content-hash id (tombstone-stable: line shifts never change it), exact
 * quotes, and never touch the network — the only input is the injected
 * IndexProvider snapshot.
 */

const HEX16 = /^[0-9a-f]{16}$/u;

function makeNote(path: string, extra: Partial<Note> = {}): Note {
  const stem = path.split("/").pop() ?? path;
  return {
    path,
    title: stem.replace(/\.md$/u, ""),
    aliases: [],
    tags: [],
    relations: [],
    body: "",
    links: [],
    mtime: 0,
    ...extra,
  };
}

/** Minimal provider over a fixed note list; only all() is consumed by the auditor. */
function providerOf(notes: Note[]): IndexProvider {
  const boom = (): never => {
    throw new Error("auditRules must only consume the snapshot via all()");
  };
  return {
    all: () => notes,
    upsert: boom,
    remove: boom,
    byTitleOrAlias: boom,
    backlinks: boom,
    links: boom,
    search: boom,
    persist: boom,
    load: boom,
  };
}

function kinds(findings: Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
  }
  return counts;
}

describe("auditRules — duplicate aliases", () => {
  it("flags an alias claimed by two different notes as one pair finding", () => {
    const findings = auditRules(
      providerOf([
        makeNote("factions/Iron Compact.md", { aliases: ["The Compact"] }),
        makeNote("campaigns/Compact War.md", { aliases: ["The Compact"] }),
      ]),
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.kind).toBe("duplicate-alias");
    // Pair order normalized: noteA < noteB lexicographically, always.
    expect(finding?.noteA).toBe("campaigns/Compact War.md");
    expect(finding?.noteB).toBe("factions/Iron Compact.md");
    expect(finding?.quoteA).toContain("The Compact");
    expect(finding?.quoteB).toContain("The Compact");
    expect(finding?.message).toContain("The Compact");
  });

  it("counts a title-vs-alias collision (campaign name vs item name)", () => {
    const findings = auditRules(
      providerOf([
        makeNote("items/The Ashen Crown.md", {
          title: "The Ashen Crown",
          aliases: ["The Crown"],
        }),
        makeNote("campaigns/The Ashen Crown (Campaign).md", {
          title: "The Ashen Crown (Campaign)",
          aliases: ["The Ashen Crown"],
        }),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("duplicate-alias");
    expect(findings[0]?.quoteA).toBe('alias "The Ashen Crown"');
    expect(findings[0]?.quoteB).toBe('title "The Ashen Crown"');
  });

  it("tolerates an alias that repeats the note's own title", () => {
    const findings = auditRules(
      providerOf([
        makeNote("characters/Kestrel.md", {
          title: "Kestrel",
          aliases: ["Kestrel", "Kestrel"],
        }),
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("detects collisions case-insensitively", () => {
    const findings = auditRules(
      providerOf([
        makeNote("a.md", { aliases: ["The Crown"] }),
        makeNote("b.md", { aliases: ["the crown"] }),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("duplicate-alias");
  });

  it("emits one finding per pair when three notes claim one name", () => {
    const findings = auditRules(
      providerOf([
        makeNote("a.md", { aliases: ["Wraith"] }),
        makeNote("b.md", { aliases: ["Wraith"] }),
        makeNote("c.md", { aliases: ["Wraith"] }),
      ]),
    );
    expect(findings).toHaveLength(3);
    expect(
      findings.map((f) => `${f.noteA}+${f.noteB}`).sort(),
    ).toEqual(["a.md+b.md", "a.md+c.md", "b.md+c.md"]);
  });
});

describe("auditRules — relations to missing notes", () => {
  it("flags a relation whose target matches no note", () => {
    const findings = auditRules(
      providerOf([
        makeNote("characters/Brannoc.md", {
          relations: [{ kind: "commands", target: "Tidecrow" }],
        }),
        makeNote("characters/Kestrel.md"),
      ]),
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.kind).toBe("missing-relation-target");
    expect(finding?.noteA).toBe("characters/Brannoc.md");
    // Frontmatter-level finding: line unknown at index level (edge.ts precedent).
    expect(finding?.lineA).toBe(-1);
    expect(finding?.quoteA).toContain("commands");
    expect(finding?.quoteA).toContain("Tidecrow");
    expect(finding?.noteB).toBeUndefined();
    expect(finding?.lineB).toBeUndefined();
  });

  it("accepts targets that resolve via alias, path, path.md, or file stem", () => {
    const findings = auditRules(
      providerOf([
        makeNote("places/Vael'Thor.md", { title: "Vael'Thor" }),
        makeNote("sessions/Session 01 - Arrival.md", { title: "Session 01 – Arrival" }),
        makeNote("characters/A.md", {
          relations: [
            { kind: "born_in", target: "Vael'Thor" }, // title
            { kind: "visited", target: "places/Vael'Thor.md" }, // path + .md
            { kind: "saw", target: "Session 01 - Arrival" }, // file stem ≠ H1
            { kind: "met", target: "The Grey Lens" }, // alias of Sereth Vane below
          ],
        }),
        makeNote("characters/Sereth Vane.md", { aliases: ["The Grey Lens"] }),
      ]),
    );
    expect(findings).toEqual([]);
  });
});

describe("auditRules — dead wikilinks", () => {
  it("flags an unresolvable link with its 0-based line and exact quote", () => {
    const findings = auditRules(
      providerOf([
        makeNote("characters/Aelindra.md", {
          body: "She is watched by [[Order of the Pale Hand]] daily.",
          links: [
            {
              source: "characters/Aelindra.md",
              target: "Order of the Pale Hand",
              line: 0,
            },
          ],
        }),
        makeNote("characters/Kestrel.md", { title: "Kestrel" }),
      ]),
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.kind).toBe("dead-link");
    expect(finding?.noteA).toBe("characters/Aelindra.md");
    expect(finding?.lineA).toBe(0);
    expect(finding?.quoteA).toBe("[[Order of the Pale Hand]]");
    expect(finding?.noteB).toBeUndefined();
  });

  it("quotes pipe links with their display text", () => {
    const findings = auditRules(
      providerOf([
        makeNote("a.md", {
          links: [
            { source: "a.md", target: "Ghost", line: 3, display: "the ghost" },
          ],
        }),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.quoteA).toBe("[[Ghost|the ghost]]");
    expect(findings[0]?.lineA).toBe(3);
  });

  it("dedupes repeated dead links to the same target within one note", () => {
    const findings = auditRules(
      providerOf([
        makeNote("a.md", {
          links: [
            { source: "a.md", target: "Ghost", line: 1 },
            { source: "a.md", target: "Ghost", line: 9 },
          ],
        }),
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.lineA).toBe(1); // first occurrence wins
  });

  it("resolves links via path, .md suffix, alias, and file stem — no findings", () => {
    const findings = auditRules(
      providerOf([
        makeNote("places/Vael'Thor.md", { title: "Vael'Thor" }),
        makeNote("characters/Sereth Vane.md", { aliases: ["The Grey Lens"] }),
        makeNote("sessions/Session 02 - The Road.md", { title: "Session 02 – The Road" }),
        makeNote("a.md", {
          links: [
            { source: "a.md", target: "Vael'Thor", line: 0 },
            { source: "a.md", target: "places/Vael'Thor.md", line: 1 },
            { source: "a.md", target: "the grey lens", line: 2 },
            { source: "a.md", target: "Session 02 - The Road", line: 3 },
          ],
        }),
      ]),
    );
    expect(findings).toEqual([]);
  });
});

describe("auditRules — temporal overlap conflicts", () => {
  it("flags two notes sharing a name whose numeric eras overlap", () => {
    const findings = auditRules(
      providerOf([
        makeNote("events/Siege.md", {
          aliases: ["The Long War"],
          temporal: { from: "Session 2", to: "Session 4" },
        }),
        makeNote("events/Treaty.md", {
          aliases: ["The Long War"],
          temporal: { from: "Session 4" },
        }),
      ]),
    );
    // Shared name also fires the duplicate-alias rule; isolate the temporal one.
    expect(kinds(findings)).toEqual({
      "duplicate-alias": 1,
      "temporal-overlap": 1,
    });
    const [finding] = findings.filter((f) => f.kind === "temporal-overlap");
    expect(finding?.quoteA).toContain("Session 2");
    expect(finding?.quoteB).toContain("Session 4");
    expect(finding?.noteB).toBeDefined();
    expect(finding?.lineA).toBe(-1);
    expect(finding?.lineB).toBe(-1);
  });

  it("stays silent when the numeric eras are disjoint", () => {
    const findings = auditRules(
      providerOf([
        makeNote("a.md", {
          aliases: ["Halden"],
          temporal: { from: "Session 1", to: "Session 2" },
        }),
        makeNote("b.md", {
          aliases: ["Halden"],
          temporal: { from: "Session 4", to: "Session 5" },
        }),
      ]),
    );
    expect(findings.filter((f) => f.kind === "temporal-overlap")).toEqual([]);
  });

  it("flags identical era labels (case-insensitive) as overlapping", () => {
    const findings = auditRules(
      providerOf([
        makeNote("campaigns/The Ashen Crown (Campaign).md", {
          aliases: ["The Ashen Crown"],
          temporal: { from: "Age of Ash" },
        }),
        makeNote("items/The Ashen Crown.md", {
          title: "The Ashen Crown",
          temporal: { from: "age of ash" },
        }),
      ]),
    );
    const temporal = findings.filter((f) => f.kind === "temporal-overlap");
    expect(temporal).toHaveLength(1);
    expect(temporal[0]?.kind).toBe("temporal-overlap");
  });

  it("stays silent when eras are not provably comparable or names differ", () => {
    const notes = [
      // Same name, incomparable labels: free-form era vs numeric session.
      makeNote("a.md", {
        aliases: ["Twin"],
        temporal: { from: "Age of Ash" },
      }),
      makeNote("b.md", {
        aliases: ["Twin"],
        temporal: { from: "Session 3" },
      }),
      // Same era, no shared identity — two notes living in one era is normal.
      makeNote("c.md", { temporal: { from: "Age of Ash" } }),
      makeNote("d.md", { temporal: { from: "Age of Ash", to: "Age of Ash" } }),
      // Shared name, disjoint free-form eras: not provable, stays silent.
      makeNote("e.md", {
        aliases: ["Solo"],
        temporal: { from: "Before the Ash" },
      }),
      makeNote("f.md", {
        aliases: ["Solo"],
        temporal: { from: "The Sundering" },
      }),
    ];
    const findings = auditRules(providerOf(notes));
    expect(findings.filter((f) => f.kind === "temporal-overlap")).toEqual([]);
  });

  it("flags an inverted numeric range on the owning note alone", () => {
    const findings = auditRules(
      providerOf([
        makeNote("sessions/Session 05.md", {
          temporal: { from: "Session 5", to: "Session 3" },
        }),
      ]),
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.kind).toBe("temporal-overlap");
    expect(finding?.noteA).toBe("sessions/Session 05.md");
    expect(finding?.noteB).toBeUndefined();
    expect(finding?.message).toContain("Session 5");
    expect(finding?.message).toContain("Session 3");
  });
});

describe("auditRules — finding identity, hashing, determinism", () => {
  it("produces identical ids across reruns, with every id unique and 16-hex", () => {
    const notes = [
      makeNote("a.md", {
        aliases: ["Ghost King"],
        links: [{ source: "a.md", target: "Nobody", line: 2 }],
      }),
      makeNote("b.md", { aliases: ["Ghost King"] }),
      makeNote("c.md", {
        relations: [{ kind: "destroyed", target: "Nowhere" }],
      }),
    ];
    const first = auditRules(providerOf(notes));
    const second = auditRules(providerOf([...notes].reverse()));
    expect(first.length).toBeGreaterThanOrEqual(3);
    expect(second).toEqual(first); // same ids AND same order, any input order
    const ids = first.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(HEX16);
  });

  it("keeps ids stable when body edits shift line numbers (tombstones survive)", () => {
    const noteAt = (offset: number): Note =>
      makeNote("a.md", {
        body: `${"\n".repeat(offset)}See [[Nobody]].`,
        links: [{ source: "a.md", target: "Nobody", line: offset }],
      });
    const [before] = auditRules(providerOf([noteAt(0)]));
    const [after] = auditRules(providerOf([noteAt(5)]));
    expect(before?.kind).toBe("dead-link");
    expect(after?.lineA).toBe(5); // locator moved…
    expect(after?.id).toBe(before?.id); // …identity did not
  });

  it("gives distinct findings distinct ids (no cross-kind or cross-note collisions)", () => {
    const findings = auditRules(
      providerOf([
        makeNote("a.md", {
          aliases: ["Dup"],
          links: [{ source: "a.md", target: "Ghost", line: 0 }],
        }),
        makeNote("b.md", { aliases: ["Dup"] }),
      ]),
    );
    expect(kinds(findings)).toEqual({
      "duplicate-alias": 1,
      "dead-link": 1,
    });
    expect(new Set(findings.map((f) => f.id)).size).toBe(2);
  });

  it("returns an empty array for an empty vault", () => {
    expect(auditRules(providerOf([]))).toEqual([]);
  });
});

describe("auditRules — fixture vault (fixtures/vault-sample, seeded contradictions)", () => {
  const fixtureRoot = fileURLToPath(
    new URL("../../../fixtures/vault-sample", import.meta.url),
  );

  function loadFixtureIndex(): MemoryIndex {
    const index = new MemoryIndex();
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(join(dir, entry.name), rel);
        } else if (entry.name.endsWith(".md")) {
          const content = readFileSync(join(dir, entry.name), "utf8");
          index.upsert(parseNote(rel, content));
        }
      }
    };
    walk(fixtureRoot, "");
    return index;
  }

  it("finds exactly the seeded structural contradictions and nothing else", () => {
    const findings = auditRules(loadFixtureIndex());
    expect(kinds(findings)).toEqual({
      "duplicate-alias": 1, // "The Ashen Crown": campaign ↔ item
      "missing-relation-target": 2, // Tidecrow, The Salty Ledger
      "temporal-overlap": 1, // both Ashen Crowns live in "Age of Ash"
      "dead-link": 6, // 4 dangling targets across 6 notes
    });
    const deadTargets = findings
      .filter((f) => f.kind === "dead-link")
      .map((f) => f.quoteA)
      .sort();
    expect(deadTargets).toEqual([
      "[[Mira's Locket]]",
      "[[Order of the Pale Hand]]",
      "[[Order of the Pale Hand]]",
      "[[The Weeping Gate]]",
      "[[Vault of Whispers]]",
      "[[Vault of Whispers]]",
    ]);
    const missing = findings
      .filter((f) => f.kind === "missing-relation-target")
      .map((f) => f.quoteA)
      .sort();
    expect(missing).toEqual(['commands → "Tidecrow"', 'owns → "The Salty Ledger"']);
    for (const finding of findings) expect(finding.id).toMatch(HEX16);
  });
});

describe("auditRules — performance budget (PLAN-M2 B3: 2k notes < 500ms)", () => {
  it("audits a 2000-note synthetic vault in under 500ms", () => {
    const notes: Note[] = [];
    for (let i = 0; i < 2000; i++) {
      const links = [{ source: `n${i}.md`, target: `Entity ${i + 1}`, line: i % 7 }];
      if (i % 5 === 0) {
        links.push({ source: `n${i}.md`, target: `Ghost ${i}`, line: (i % 7) + 1 });
      }
      const relations =
        i % 11 === 0
          ? [{ kind: "knows", target: `Missing ${i}` }]
          : [{ kind: "knows", target: `Entity ${i + 2}` }];
      notes.push(
        makeNote(`n${i}.md`, {
          title: `Entity ${i}`,
          aliases: i % 40 === 0 ? ["Shared Elder"] : [`E${i}`],
          relations,
          links,
          ...(i % 3 === 0
            ? { temporal: { from: `Session ${i % 12}`, to: `Session ${(i % 12) + 1}` } }
            : {}),
        }),
      );
    }
    const started = performance.now();
    const findings = auditRules(providerOf(notes));
    const elapsed = performance.now() - started;
    expect(findings.length).toBeGreaterThan(0); // the run actually did work
    expect(elapsed).toBeLessThan(500);
  });
});

// Type-level sanity: the exported Finding shape matches PLAN-M2 B3 exactly.
const _shapeCheck: Finding = {
  id: "0123456789abcdef",
  kind: "dead-link" as FindingKind,
  noteA: "a.md",
  lineA: 0,
  quoteA: "[[x]]",
  noteB: "b.md",
  lineB: 1,
  quoteB: "[[y]]",
  message: "x",
};
void _shapeCheck;
