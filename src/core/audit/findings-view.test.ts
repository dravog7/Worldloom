/**
 * M2 Wave D2 — findings presentation logic (PLAN-M2 §D2): severity sort,
 * note grouping, tombstone-filtered row building, and the pre-run cost
 * estimate math. Pure-logic TDD; FindingsPanel is a thin shell over these.
 */
import { describe, expect, it } from "vitest";
import { estimateMessageTokens, estimateTokens } from "../ai/extract";
import { auditV1, toChatMessages } from "../ai/prompts";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "../ai/settings";
import { makeNote } from "../vault/test-fakes";
import {
  AUDIT_OUTPUT_TOKENS_PER_BATCH,
  buildFindingRows,
  estimateAuditCost,
  findingQuotes,
  formatUsd,
  groupFindingsByNote,
  llmAuditGate,
  pendingAuditNotes,
  planAuditPass,
  severityRank,
  sortFindings,
} from "./findings-view";
import { DEFAULT_AUDIT_BATCH_TOKENS, emptyAuditState, type AuditState } from "./llm";
import type { AuditFinding, LlmFinding } from "./llm";
import type { Finding } from "./rules";

/* ---- tiny fixture builders (ids are arbitrary strings here) ---- */

const deadLink = (id: string, note: string, line: number, target: string): Finding => ({
  id,
  kind: "dead-link",
  noteA: note,
  lineA: line,
  quoteA: `[[${target}]]`,
  message: `Link target "${target}" matches no note in the vault.`,
});

const duplicate = (id: string, a: string, b: string): Finding => ({
  id,
  kind: "duplicate-alias",
  noteA: a,
  lineA: -1,
  quoteA: 'alias "Ellara"',
  noteB: b,
  lineB: -1,
  quoteB: 'title "Ellara"',
  message: '"Ellara" is claimed by two notes.',
});

const missingRelation = (id: string, note: string): Finding => ({
  id,
  kind: "missing-relation-target",
  noteA: note,
  lineA: -1,
  quoteA: 'ruler → "Ghost Queen"',
  message: 'Relation "ruler" targets "Ghost Queen", but no note matches.',
});

const temporal = (id: string, a: string, b?: string): Finding => {
  const finding: Finding = {
    id,
    kind: "temporal-overlap",
    noteA: a,
    lineA: -1,
    quoteA: 'temporal: from "Session 3" to "Session 5"',
    message: "eras overlap",
  };
  if (b !== undefined) {
    finding.noteB = b;
    finding.lineB = -1;
    finding.quoteB = 'temporal: from "Session 4" to "Session 6"';
  }
  return finding;
};

const llmFinding = (id: string, a: string, b: string): LlmFinding => ({
  id,
  kind: "llm-contradiction",
  noteA: a,
  lineA: 2,
  quoteA: "Ellara never left the coast.",
  noteB: b,
  lineB: 5,
  quoteB: "Ellara's exile in the inland wastes began at dawn.",
  message: "The notes disagree about where Ellara was.",
});

describe("severityRank / sortFindings", () => {
  it("ranks kinds in the frozen severity order (llm first, dead link last)", () => {
    expect(severityRank("llm-contradiction")).toBeLessThan(severityRank("duplicate-alias"));
    expect(severityRank("duplicate-alias")).toBeLessThan(severityRank("missing-relation-target"));
    expect(severityRank("missing-relation-target")).toBeLessThan(severityRank("temporal-overlap"));
    expect(severityRank("temporal-overlap")).toBeLessThan(severityRank("dead-link"));
  });

  it("sorts by severity first, then noteA path — severity beats path order", () => {
    const sorted = sortFindings([
      deadLink("d1", "a.md", 3, "Nowhere"),
      llmFinding("l1", "z.md", "y.md"),
      duplicate("u1", "m.md", "n.md"),
      missingRelation("r1", "b.md"),
      temporal("t1", "c.md"),
    ]);
    expect(sorted.map((f) => f.kind)).toEqual([
      "llm-contradiction",
      "duplicate-alias",
      "missing-relation-target",
      "temporal-overlap",
      "dead-link",
    ]);
  });

  it("is deterministic: same kind + noteA falls back to line, noteB, id", () => {
    const a = deadLink("b-id", "a.md", 4, "X");
    const b = deadLink("a-id", "a.md", 4, "Y");
    const c = deadLink("c-id", "a.md", 1, "Z");
    expect(sortFindings([a, b, c]).map((f) => f.id)).toEqual(["c-id", "a-id", "b-id"]);
    // Pure function: input array untouched.
    const input = [a, b, c];
    sortFindings(input);
    expect(input.map((f) => f.id)).toEqual(["b-id", "a-id", "c-id"]);
  });
});

describe("groupFindingsByNote", () => {
  it("groups by noteA, groups sorted by path, findings keep severity order inside", () => {
    const groups = groupFindingsByNote([
      deadLink("d1", "z/last.md", 3, "Nowhere"),
      llmFinding("l1", "a/first.md", "b/other.md"),
      deadLink("d2", "z/last.md", 7, "Gone"),
    ]);
    expect(groups.map((g) => g.path)).toEqual(["a/first.md", "z/last.md"]);
    expect(groups[0]?.findings.map((f) => f.id)).toEqual(["l1"]);
    expect(groups[1]?.findings.map((f) => f.id)).toEqual(["d1", "d2"]);
  });

  it("returns [] for no findings", () => {
    expect(groupFindingsByNote([])).toEqual([]);
  });
});

describe("findingQuotes", () => {
  it("emits both quote refs for an llm finding (A then B, verbatim)", () => {
    const quotes = findingQuotes(llmFinding("l1", "a.md", "b.md"));
    expect(quotes).toEqual([
      { side: "A", note: "a.md", line: 2, quote: "Ellara never left the coast." },
      { side: "B", note: "b.md", line: 5, quote: "Ellara's exile in the inland wastes began at dawn." },
    ]);
  });

  it("emits a single A quote ref for a rules finding without noteB", () => {
    const quotes = findingQuotes(deadLink("d1", "a.md", 3, "Nowhere"));
    expect(quotes).toEqual([{ side: "A", note: "a.md", line: 3, quote: "[[Nowhere]]" }]);
  });
});

describe("buildFindingRows", () => {
  const findings: AuditFinding[] = [
    duplicate("u1", "people/A.md", "people/B.md"),
    deadLink("d1", "places/C.md", 3, "Nowhere"),
    llmFinding("l1", "people/A.md", "people/C.md"),
  ];

  it("suppresses dismissed findings and leaves the rest visible", () => {
    const state = { ...emptyAuditState(), dismissed: { u1: 1_700_000_000_000 } };
    const rows = buildFindingRows(findings, { auditState: state, expanded: new Set() });
    const ids = rows.flatMap((group) => group.findings.map((row) => row.id));
    expect(ids).toEqual(["l1", "d1"]);
    expect(ids).not.toContain("u1");
  });

  it("groups collapsed unless the path is in the expanded set", () => {
    const rows = buildFindingRows(findings, {
      auditState: emptyAuditState(),
      expanded: new Set(["people/A.md"]),
    });
    expect(rows.map((g) => [g.path, g.expanded])).toEqual([
      ["people/A.md", true],
      ["places/C.md", false],
    ]);
  });

  it("rows carry kind badge label, message, and quote refs", () => {
    const rows = buildFindingRows(findings, {
      auditState: emptyAuditState(),
      expanded: new Set(["people/A.md"]),
    });
    const first = rows[0]?.findings[0];
    expect(first?.kind).toBe("llm-contradiction");
    expect(first?.kindLabel).toBe("AI contradiction");
    expect(first?.message).toBe("The notes disagree about where Ellara was.");
    expect(first?.quotes.map((q) => q.side)).toEqual(["A", "B"]);
  });
});

describe("estimateAuditCost", () => {
  const options = { priceInputPerM: 2, priceOutputPerM: 8, tokensPerBatch: 6_000 };

  it("input = batches × tokensPerBatch priced per 1M; output allowance on top", () => {
    const cost = estimateAuditCost(5, 3, options);
    // 3 × 6000 = 18 000 input tokens @ $2/1M = $0.036
    expect(cost.inputUsd).toBeCloseTo(0.036, 10);
    // 3 × 1000 output-allowance tokens @ $8/1M = $0.024
    expect(cost.totalUsd).toBeCloseTo(0.036 + 0.024, 10);
  });

  it("zero batches (nothing pending) costs nothing even with notes present", () => {
    expect(estimateAuditCost(12, 0, options)).toEqual({ inputUsd: 0, totalUsd: 0 });
  });

  it("garbage counts and prices clamp to zero instead of NaN/Infinity", () => {
    const cost = estimateAuditCost(-3, Number.NaN, {
      priceInputPerM: Number.POSITIVE_INFINITY,
      priceOutputPerM: -1,
      tokensPerBatch: -5,
    });
    expect(cost).toEqual({ inputUsd: 0, totalUsd: 0 });
  });

  it("clamps the batch count to the note count (a batch holds ≥1 note)", () => {
    const cost = estimateAuditCost(2, 99, options);
    // 2 batches × 6000 @ $2/1M + 2 × 1000 @ $8/1M
    expect(cost.inputUsd).toBeCloseTo((2 * 6_000) / 1e6 * 2, 12);
    expect(cost.totalUsd).toBeCloseTo((2 * 6_000) / 1e6 * 2 + (2 * AUDIT_OUTPUT_TOKENS_PER_BATCH) / 1e6 * 8, 12);
  });

  it("zero prices (untouched cost table) read as free", () => {
    expect(estimateAuditCost(4, 4, { priceInputPerM: 0, priceOutputPerM: 0, tokensPerBatch: 6_000 }))
      .toEqual({ inputUsd: 0, totalUsd: 0 });
  });
});

describe("formatUsd", () => {
  it("renders cents-scale amounts with 4 decimals and guards garbage", () => {
    expect(formatUsd(0.036)).toBe("$0.0360");
    expect(formatUsd(0)).toBe("$0.0000");
    expect(formatUsd(Number.NaN)).toBe("$0.0000");
  });
});

describe("pendingAuditNotes / planAuditPass", () => {
  const notes = [
    makeNote("a.md", { title: "Alpha", body: "Alpha line.", mtime: 1 }),
    makeNote("b.md", { title: "Beta", body: "Beta line.", mtime: 2 }),
  ];

  it("pending = notes never audited or whose mtime changed", () => {
    const fresh = emptyAuditState();
    expect(pendingAuditNotes(notes, fresh).map((n) => n.path)).toEqual(["a.md", "b.md"]);
    const stamped: AuditState = { ...fresh, lastAudit: { "a.md": 1 } };
    expect(pendingAuditNotes(notes, stamped).map((n) => n.path)).toEqual(["b.md"]);
    const edited: AuditState = { ...fresh, lastAudit: { "a.md": 999 } };
    expect(pendingAuditNotes(notes, edited).map((n) => n.path)).toEqual(["a.md", "b.md"]);
  });

  it("charges every batch with the SAME estimator the audit sends (system + user turns)", () => {
    const plan = planAuditPass(notes, emptyAuditState());
    expect(plan.pendingNotes.map((n) => n.path)).toEqual(["a.md", "b.md"]);
    expect(plan.batches).toBe(1); // both tiny notes pack into the 6k budget
    const expected = estimateMessageTokens(
      toChatMessages(auditV1, {
        notes: [
          { path: "a.md", title: "Alpha", content: "Alpha line." },
          { path: "b.md", title: "Beta", content: "Beta line." },
        ],
      }),
    );
    expect(plan.totalInputTokens).toBe(expected);
    expect(plan.tokensPerBatch).toBe(expected / 1);
  });

  it("splits oversized notes into their own batches and averages tokensPerBatch", () => {
    const bigA = makeNote("big-a.md", { title: "Big A", body: "x".repeat(4 * DEFAULT_AUDIT_BATCH_TOKENS), mtime: 1 });
    const bigB = makeNote("big-b.md", { title: "Big B", body: "y".repeat(4 * DEFAULT_AUDIT_BATCH_TOKENS), mtime: 2 });
    const plan = planAuditPass([bigA, bigB], emptyAuditState());
    // Each note blows the 6k budget alone → one batch each, none dropped.
    expect(plan.batches).toBe(2);
    expect(plan.totalInputTokens).toBeCloseTo(plan.batches * plan.tokensPerBatch, 6);
    expect(plan.tokensPerBatch).toBeGreaterThan(0);
    expect(plan.totalInputTokens).toBeGreaterThan(estimateTokens(bigA.body));
  });

  it("no pending notes → zero batches, zero tokens", () => {
    const state: AuditState = { ...emptyAuditState(), lastAudit: { "a.md": 1, "b.md": 2 } };
    const plan = planAuditPass(notes, state);
    expect(plan).toMatchObject({ batches: 0, totalInputTokens: 0, tokensPerBatch: 0 });
    expect(plan.pendingNotes).toEqual([]);
  });
});

describe("llmAuditGate", () => {
  const remote: AiSettings = { ...DEFAULT_AI_SETTINGS }; // openai + model, no key

  it("needs an API key for a remote provider — exact one-line note", () => {
    const gate = llmAuditGate(remote, false);
    expect(gate.configured).toBe(false);
    expect(gate.note).toBe("LLM pass needs an API key — rules pass still works");
    // Unknown key status fails closed, same note.
    expect(llmAuditGate(remote, null).configured).toBe(false);
  });

  it("is configured for a remote provider with a stored key", () => {
    expect(llmAuditGate(remote, true)).toEqual({ configured: true, note: null });
  });

  it("local (loopback) providers need no key", () => {
    const ollama: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      preset: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
    };
    expect(llmAuditGate(ollama, false).configured).toBe(true);
  });

  it("unconfigured endpoint/model reports the reason, still mentions the rules pass", () => {
    const gate = llmAuditGate({ ...DEFAULT_AI_SETTINGS, baseUrl: "junk", model: "" }, true);
    expect(gate.configured).toBe(false);
    expect(gate.note).toContain("endpoint is not a URL");
    expect(gate.note).toContain("rules pass still works");
  });
});
