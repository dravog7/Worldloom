import { describe, expect, it } from "vitest";
import { auditV1 } from "../ai/prompts";
import { AiError, type ChatRequest, type Transport } from "../ai/types";
import { estimateTokens } from "../ai/extract";
import type { IndexProvider } from "../index/provider";
import type { Note } from "../types";
import { contentHash } from "../vault/hash";
import { auditRules, type Finding } from "./rules";
import {
  DEFAULT_AUDIT_BATCH_TOKENS,
  dismissFinding,
  isDismissed,
  llmAudit,
  loadAuditState,
  mergeAuditFindings,
  parseAuditResponse,
  runLlmAudit,
  selectAuditContext,
  serializeAuditState,
  vaultFingerprint,
  type AuditState,
  type AuditStatePort,
  type LlmFinding,
} from "./llm";

/**
 * M2 Wave D1 (PLAN-M2): the LLM audit pass.
 *
 * Contract under test:
 * - llmAudit slices the vault into prompt-sized batches (selectAuditContext),
 *   sends the frozen audit-v1 prompt through an injected Transport, and turns
 *   canned model JSON into LlmFindings — same shape as rules.ts findings
 *   (kind "llm-contradiction", two verbatim quotes + 0-based line locators).
 * - Malformed model output surfaces as a typed AiError("invalid-response");
 *   the parser itself never throws and never touches the vault.
 * - Tombstone state ({version, vaultHash, dismissed, lastAudit}) suppresses
 *   dismissed findings across re-audits and re-audits a note only when its
 *   mtime changed. State I/O goes exclusively through the injected
 *   AuditStatePort — the module never writes notes.
 */

const BASE_URL = "http://localhost:11434/v1";
const MODEL = "llama3";
const HEX16 = /^[0-9a-f]{16}$/u;

/* ------------------------------------------------------------------ */
/* Fakes                                                                */
/* ------------------------------------------------------------------ */

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

/** Minimal provider over a fixed note list (only all() is consumed). */
function providerOf(notes: Note[]): IndexProvider {
  const boom = (): never => {
    throw new Error("llmAudit must only consume the snapshot via all()");
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

/** Transport fake: canned responses in order, records every request. */
function fakeTransport(responses: string[]): Transport & {
  requests: ChatRequest[];
} {
  const requests: ChatRequest[] = [];
  let next = 0;
  return {
    requests,
    async chat(request: ChatRequest) {
      requests.push(request);
      const content = responses[next];
      next += 1;
      if (content === undefined) {
        throw new Error("fakeTransport: no response queued for this request");
      }
      return { content, latencyMs: 1 };
    },
  };
}

/** In-memory AuditStatePort that records writes. */
function fakePort(raw: string | null): AuditStatePort & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    read: async () => raw,
    write: async (serialized: string) => {
      writes.push(serialized);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Canned model payloads                                                */
/* ------------------------------------------------------------------ */

const KESTREL_BODY = ["Line zero.", "Kestrel was born in Vael'Thor.", "Line two."].join("\n");
const FALL_BODY = ["First.", "Second.", "She died in the Weeping Gate uprising."].join("\n");

const AUDIT_NOTES: Note[] = [
  makeNote("characters/Kestrel.md", { title: "Kestrel", body: KESTREL_BODY, mtime: 10 }),
  makeNote("events/Fall of Vael'Thor.md", { title: "Fall of Vael'Thor", body: FALL_BODY, mtime: 20 }),
];

function contradiction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    noteA: "characters/Kestrel.md",
    quoteA: "born in Vael'Thor",
    noteB: "events/Fall of Vael'Thor.md",
    quoteB: "died in the Weeping Gate",
    message: "Kestrel is said to die at the Fall here but is alive later.",
    confidence: 0.8,
    ...overrides,
  };
}

function responseWith(entries: unknown[]): string {
  return JSON.stringify({ findings: entries });
}

const EMPTY_RESPONSE = responseWith([]);

/* ------------------------------------------------------------------ */
/* selectAuditContext — batching under/over budget                      */
/* ------------------------------------------------------------------ */

describe("selectAuditContext — prompt-sized batching", () => {
  it("returns no batches for an empty vault", () => {
    expect(selectAuditContext([])).toEqual([]);
  });

  it("packs notes that fit the budget into a single batch", () => {
    const notes = ["a.md", "b.md", "c.md"].map((path) => makeNote(path, { body: "short" }));
    const batches = selectAuditContext(notes, 1_000_000);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((n) => n.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("splits over-budget sets greedily, carrying path and title into each batch", () => {
    // Deterministic stub: 100 tokens per normal note, 10_000 for a HUGE one.
    const estimator = (text: string): number => (text.includes("HUGE") ? 10_000 : 100);
    const notes = [
      makeNote("a.md", { title: "Alpha", body: "normal" }),
      makeNote("b.md", { title: "Beta", body: "normal" }),
      makeNote("c.md", { title: "Gamma", body: "normal" }),
    ];
    const batches = selectAuditContext(notes, 250, estimator);
    expect(batches.map((batch) => batch.map((n) => n.path))).toEqual([
      ["a.md", "b.md"],
      ["c.md"],
    ]);
    expect(batches[0]?.[0]).toEqual({ path: "a.md", title: "Alpha", content: "normal" });
  });

  it("gives an oversized note its own batch instead of dropping it", () => {
    const estimator = (text: string): number => (text.includes("HUGE") ? 10_000 : 100);
    const notes = [
      makeNote("a.md", { body: "normal" }),
      makeNote("huge.md", { body: "HUGE" }),
      makeNote("b.md", { body: "normal" }),
    ];
    const batches = selectAuditContext(notes, 250, estimator);
    // Greedy: a+b pack first (200 ≤ 250); the oversized note flushes them
    // and gets a batch of its own — never dropped.
    expect(batches.map((batch) => batch.map((n) => n.path))).toEqual([
      ["a.md", "b.md"],
      ["huge.md"],
    ]);
  });

  it("batches by path for determinism, regardless of input order, with the 6k default", () => {
    expect(DEFAULT_AUDIT_BATCH_TOKENS).toBe(6_000);
    const notes = [makeNote("z.md"), makeNote("a.md"), makeNote("m.md")];
    const forward = selectAuditContext(notes);
    const reverse = selectAuditContext([...notes].reverse());
    expect(reverse).toEqual(forward); // default estimator, default budget
    expect(forward[0]?.map((n) => n.path)).toEqual(["a.md", "m.md", "z.md"]);
    // Batches must fit the default budget under the shipped estimator.
    for (const batch of forward) {
      const cost = batch.reduce(
        (total, note) => total + estimateTokens(auditV1.user({ notes: [note] })),
        0,
      );
      expect(cost).toBeLessThanOrEqual(DEFAULT_AUDIT_BATCH_TOKENS);
    }
  });
});

/* ------------------------------------------------------------------ */
/* parseAuditResponse — quote/line extraction, typed errors             */
/* ------------------------------------------------------------------ */

describe("parseAuditResponse — canned model output", () => {
  it("extracts verbatim quotes with 0-based line numbers and a stable id", () => {
    const result = parseAuditResponse(responseWith([contradiction()]), AUDIT_NOTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings).toHaveLength(1);
    const [finding] = result.findings;
    expect(finding?.kind).toBe("llm-contradiction");
    expect(finding?.noteA).toBe("characters/Kestrel.md");
    expect(finding?.lineA).toBe(1); // "Kestrel was born in Vael'Thor."
    expect(finding?.quoteA).toBe("born in Vael'Thor");
    expect(finding?.noteB).toBe("events/Fall of Vael'Thor.md");
    expect(finding?.lineB).toBe(2); // "She died in the Weeping Gate uprising."
    expect(finding?.quoteB).toBe("died in the Weeping Gate");
    expect(finding?.message).toContain("Kestrel");
    expect(finding?.id).toMatch(HEX16);
    expect(result.dropped).toBe(0);
  });

  it("accepts fenced JSON and a bare findings array", () => {
    const fenced = parseAuditResponse(
      "```json\n" + responseWith([contradiction()]) + "\n```",
      AUDIT_NOTES,
    );
    const bare = parseAuditResponse(JSON.stringify([contradiction()]), AUDIT_NOTES);
    expect(fenced.ok && fenced.findings).toHaveLength(1);
    expect(bare.ok && bare.findings).toHaveLength(1);
  });

  it("returns a typed invalid-response error for non-JSON output", () => {
    const result = parseAuditResponse("the model rambled instead", AUDIT_NOTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(AiError);
    expect(result.error.kind).toBe("invalid-response");
  });

  it("returns a typed invalid-response error for a wrong root shape", () => {
    const result = parseAuditResponse('{"proposals":[]}', AUDIT_NOTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid-response");
  });

  it("returns a typed invalid-response error when an entry lacks a required quote", () => {
    const broken = contradiction();
    delete broken["quoteB"];
    const result = parseAuditResponse(responseWith([broken]), AUDIT_NOTES);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid-response");
    expect(result.error.message).toContain("quoteB");
  });

  it("returns a typed invalid-response error for a non-numeric confidence", () => {
    const result = parseAuditResponse(
      responseWith([contradiction({ confidence: "certain" })]),
      AUDIT_NOTES,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid-response");
    expect(result.error.message).toContain("confidence");
  });

  it("rejects oversized responses before parsing them", () => {
    const result = parseAuditResponse(responseWith([contradiction()]), AUDIT_NOTES, {
      maxChars: 10,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("invalid-response");
    expect(result.error.message).toContain("cap");
  });

  it("drops entries whose quotes are not verbatim in the named notes", () => {
    const hallucinated = contradiction({ quoteA: "Kestrel never says this" });
    const result = parseAuditResponse(responseWith([hallucinated]), AUDIT_NOTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings).toEqual([]);
    expect(result.dropped).toBe(1);
  });

  it("drops entries pointing at notes outside the audited set (and self-contradictions)", () => {
    const unknownPath = contradiction({ noteB: "nowhere/Unknown.md", quoteB: "died in the Weeping Gate" });
    const selfContradiction = contradiction({ noteB: "characters/Kestrel.md", quoteB: "born in Vael'Thor" });
    const result = parseAuditResponse(
      responseWith([unknownPath, selfContradiction]),
      AUDIT_NOTES,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings).toEqual([]);
    expect(result.dropped).toBe(2);
  });

  it("collapses duplicate entries by id and clamps out-of-range confidence", () => {
    const result = parseAuditResponse(
      responseWith([
        contradiction({ confidence: 8 }), // clamped to 1
        contradiction(), // identical id → dropped
      ]),
      AUDIT_NOTES,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings).toHaveLength(1);
    expect(result.dropped).toBe(1);
  });

  it("drops findings below the confidence threshold but keeps them by default", () => {
    const low = contradiction({ confidence: 0.4 });
    const kept = parseAuditResponse(responseWith([low]), AUDIT_NOTES);
    const filtered = parseAuditResponse(responseWith([low]), AUDIT_NOTES, {
      minConfidence: 0.5,
    });
    expect(kept.ok && kept.findings).toHaveLength(1);
    expect(filtered.ok).toBe(true);
    if (!filtered.ok) return;
    expect(filtered.findings).toEqual([]);
    expect(filtered.dropped).toBe(1);
  });

  it("orders findings canonically (noteA, lineA, noteB, lineB, id)", () => {
    const second = contradiction({
      noteA: "characters/Kestrel.md",
      quoteA: "Line two.",
      noteB: "events/Fall of Vael'Thor.md",
      quoteB: "Second.",
    });
    const first = contradiction();
    const result = parseAuditResponse(responseWith([second, first]), AUDIT_NOTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings.map((f) => f.lineA)).toEqual([1, 2]);
  });
});

/* ------------------------------------------------------------------ */
/* Finding identity — hash parity with rules.ts                         */
/* ------------------------------------------------------------------ */

describe("llm finding identity — hash determinism", () => {
  it("matches the rules.ts id formula (kind+notes+quotes, lines excluded)", () => {
    const result = parseAuditResponse(responseWith([contradiction()]), AUDIT_NOTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const finding = result.findings[0] as LlmFinding;
    const expected = contentHash(
      ["llm-contradiction", finding.noteA, finding.quoteA, finding.noteB, finding.quoteB].join(
        "\u0000",
      ),
    );
    expect(finding.id).toBe(expected);
  });

  it("keeps ids stable when body edits shift line numbers (tombstones survive)", () => {
    const shifted: Note[] = [
      makeNote("characters/Kestrel.md", {
        title: "Kestrel",
        body: `${"intro.\n".repeat(3)}${KESTREL_BODY}`,
        mtime: 11,
      }),
      AUDIT_NOTES[1] as Note,
    ];
    const before = parseAuditResponse(responseWith([contradiction()]), AUDIT_NOTES);
    const after = parseAuditResponse(responseWith([contradiction()]), shifted);
    expect(before.ok && before.findings[0]?.lineA).toBe(1);
    expect(after.ok && after.findings[0]?.lineA).toBe(4);
    expect(after.ok && after.findings[0]?.id).toBe(before.ok ? before.findings[0]?.id : "");
  });
});

/* ------------------------------------------------------------------ */
/* mergeAuditFindings                                                   */
/* ------------------------------------------------------------------ */

describe("mergeAuditFindings — dedupe by id", () => {
  const llmFinding: LlmFinding = {
    id: "aaaa1111bbbb2222",
    kind: "llm-contradiction",
    noteA: "characters/Kestrel.md",
    lineA: 1,
    quoteA: "born in Vael'Thor",
    noteB: "events/Fall of Vael'Thor.md",
    lineB: 2,
    quoteB: "died in the Weeping Gate",
    message: "Contradiction.",
  };

  it("concatenates rules then LLM findings and collapses id duplicates", () => {
    const rulesFindings = auditRules(
      providerOf([
        makeNote("a.md", {
          body: "See [[Nobody]].",
          links: [{ source: "a.md", target: "Nobody", line: 0 }],
        }),
      ]),
    );
    expect(rulesFindings).toHaveLength(1);
    const merged = mergeAuditFindings(rulesFindings, [llmFinding, { ...llmFinding }]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(rulesFindings[0]);
    expect(merged[1]).toBe(llmFinding);
    expect(new Set(merged.map((f) => f.id)).size).toBe(2);
  });

  it("never collapses a rules finding into an LLM one (kinds differ in the hash)", () => {
    const rulesFindings: Finding[] = [];
    const merged = mergeAuditFindings(rulesFindings, [llmFinding]);
    expect(merged).toEqual([llmFinding]);
  });
});

/* ------------------------------------------------------------------ */
/* llmAudit — transport wiring, batching, empty vault                   */
/* ------------------------------------------------------------------ */

describe("llmAudit — transport wiring", () => {
  it("sends zero requests for an empty vault and returns no findings", async () => {
    const transport = fakeTransport([]);
    const result = await llmAudit(providerOf([]), transport, { baseUrl: BASE_URL, model: MODEL });
    expect(transport.requests).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.batches).toBe(0);
  });

  it("wire-shapes the frozen audit-v1 prompt with baseUrl, model, temperature 0", async () => {
    const transport = fakeTransport([EMPTY_RESPONSE]);
    await llmAudit(AUDIT_NOTES, transport, { baseUrl: BASE_URL, model: MODEL });
    expect(transport.requests).toHaveLength(1);
    const [request] = transport.requests;
    expect(request?.baseUrl).toBe(BASE_URL);
    expect(request?.model).toBe(MODEL);
    expect(request?.temperature).toBe(0);
    expect(request?.messages).toHaveLength(2);
    expect(request?.messages[0]?.role).toBe("system");
    expect(request?.messages[0]?.content).toBe(auditV1.system);
    const user = request?.messages[1]?.content ?? "";
    expect(user).toContain("--- NOTE characters/Kestrel.md (title: Kestrel) ---");
    expect(user).toContain(KESTREL_BODY);
  });

  it("returns findings from canned responses and audits a provider snapshot", async () => {
    const transport = fakeTransport([responseWith([contradiction()])]);
    const result = await llmAudit(providerOf(AUDIT_NOTES), transport, {
      baseUrl: BASE_URL,
      model: MODEL,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.lineA).toBe(1);
    expect(result.auditedPaths).toEqual(["characters/Kestrel.md", "events/Fall of Vael'Thor.md"]);
    expect(result.skippedPaths).toEqual([]);
  });

  it("rejects with a typed invalid-response AiError on malformed model output", async () => {
    const transport = fakeTransport(["not json at all"]);
    const run = llmAudit(AUDIT_NOTES, transport, { baseUrl: BASE_URL, model: MODEL });
    await expect(run).rejects.toThrowError(AiError);
  });

  it("sends multiple batches for a split vault and merges findings per batch", async () => {
    const estimator = (text: string): number => (text.includes("HUGE") ? 10_000 : 100);
    const notes = [
      makeNote("a.md", { body: "A says the gate fell.", mtime: 1 }),
      makeNote("m.md", { body: "M says the gate stood.", mtime: 3 }),
      makeNote("z.md", { body: "Z says HUGE nothing.", mtime: 2 }),
    ];
    const responses = [
      // Batch 1 covers [a.md, m.md]; a valid cross-note contradiction.
      responseWith([
        contradiction({
          noteA: "a.md",
          quoteA: "the gate fell",
          noteB: "m.md",
          quoteB: "the gate stood",
          message: "a and m disagree about the gate.",
        }),
      ]),
      // Batch 2 covers only the oversized [z.md]; nothing to contradict.
      EMPTY_RESPONSE,
    ];
    const transport = fakeTransport(responses);
    const result = await llmAudit(notes, transport, {
      baseUrl: BASE_URL,
      model: MODEL,
      maxBatchTokens: 250,
      temperature: 0.2,
      estimator,
    });
    expect(result.batches).toBe(2); // path order: [a, m] then [z]
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]?.messages[1]?.content).toContain("--- NOTE a.md");
    expect(transport.requests[1]?.messages[1]?.content).toContain("--- NOTE z.md");
    expect(transport.requests[0]?.temperature).toBe(0.2);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.noteA).toBe("a.md");
    expect(result.findings[0]?.lineA).toBe(0);
    expect(result.findings[0]?.lineB).toBe(0);
    expect(result.dropped).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Tombstone state — serialization, load tolerance, dismissal           */
/* ------------------------------------------------------------------ */

describe("audit state — pure tombstone functions", () => {
  const state: AuditState = {
    version: 1,
    vaultHash: "abc123",
    dismissed: { bbbb2222aaaa1111: 2, aaaa1111bbbb2222: 1 },
    lastAudit: { "z.md": 9, "a.md": 8 },
  };

  it("serializes canonically (sorted keys) and round-trips through loadAuditState", () => {
    const serialized = serializeAuditState(state);
    expect(serialized).toBe(
      '{"version":1,"vaultHash":"abc123","dismissed":{"aaaa1111bbbb2222":1,"bbbb2222aaaa1111":2},"lastAudit":{"a.md":8,"z.md":9}}',
    );
    expect(loadAuditState(serialized)).toEqual(state);
    expect(serializeAuditState(loadAuditState(serialized))).toBe(serialized);
  });

  it("tolerates null, empty, garbage, and wrong-version payloads without throwing", () => {
    expect(loadAuditState(null)).toEqual({
      version: 1,
      vaultHash: "",
      dismissed: {},
      lastAudit: {},
    });
    expect(loadAuditState("")).toEqual(loadAuditState(null));
    expect(loadAuditState("{not json")).toEqual(loadAuditState(null));
    expect(loadAuditState("[]")).toEqual(loadAuditState(null));
    expect(
      loadAuditState(JSON.stringify({ version: 2, vaultHash: "x", dismissed: {}, lastAudit: {} })),
    ).toEqual(loadAuditState(null));
  });

  it("drops non-finite or non-number stamps when loading", () => {
    const loaded = loadAuditState(
      JSON.stringify({
        version: 1,
        vaultHash: "v",
        dismissed: { a: 1, b: "soon", c: null },
        lastAudit: { "n.md": 42, bad: Number.NaN },
      }),
    );
    expect(loaded.dismissed).toEqual({ a: 1 });
    expect(loaded.lastAudit).toEqual({ "n.md": 42 });
  });

  it("dismissFinding is pure and isDismissed reflects it", () => {
    const dismissed = dismissFinding(state, "cccc3333dddd4444", 7);
    expect(state.dismissed).toEqual({ aaaa1111bbbb2222: 1, bbbb2222aaaa1111: 2 }); // untouched
    expect(dismissed.dismissed["cccc3333dddd4444"]).toBe(7);
    expect(isDismissed(state, "aaaa1111bbbb2222")).toBe(true);
    expect(isDismissed(state, "cccc3333dddd4444")).toBe(false);
  });

  it("vaultFingerprint identifies the path set, not the content mtimes", () => {
    const a = vaultFingerprint(AUDIT_NOTES);
    const edited = vaultFingerprint(
      AUDIT_NOTES.map((note) => ({ ...note, mtime: note.mtime + 1 })),
    );
    const grown = vaultFingerprint([...AUDIT_NOTES, makeNote("extra.md")]);
    expect(edited).toBe(a);
    expect(grown).not.toBe(a);
    expect(a).toMatch(HEX16);
  });
});

/* ------------------------------------------------------------------ */
/* llmAudit + state — mtime invalidation, suppression                   */
/* ------------------------------------------------------------------ */

describe("llmAudit — tombstone state integration", () => {
  it("re-audits only notes whose mtime changed since lastAudit", async () => {
    const notes = [
      makeNote("a.md", { body: "unchanged", mtime: 100 }),
      makeNote("b.md", { body: "edited", mtime: 200 }),
    ];
    const state: AuditState = {
      version: 1,
      vaultHash: "",
      dismissed: {},
      lastAudit: { "a.md": 100 },
    };
    const transport = fakeTransport([EMPTY_RESPONSE]);
    const result = await llmAudit(notes, transport, { baseUrl: BASE_URL, model: MODEL, state });
    expect(result.auditedPaths).toEqual(["b.md"]);
    expect(result.skippedPaths).toEqual(["a.md"]);
    expect(transport.requests).toHaveLength(1);
    const user = transport.requests[0]?.messages[1]?.content ?? "";
    expect(user).toContain("--- NOTE b.md");
    expect(user).not.toContain("a.md");
    expect(result.state.lastAudit).toEqual({ "a.md": 100, "b.md": 200 });
    expect(result.state.vaultHash).toBe(vaultFingerprint(notes));
  });

  it("suppresses dismissed findings across re-audits of an unchanged vault", async () => {
    const response = responseWith([contradiction()]);
    const first = await llmAudit(AUDIT_NOTES, fakeTransport([response]), {
      baseUrl: BASE_URL,
      model: MODEL,
    });
    expect(first.findings).toHaveLength(1);
    const id = first.findings[0]?.id ?? "";
    const dismissedState = dismissFinding(first.state, id, 1_700_000_000_000);

    const second = await llmAudit(AUDIT_NOTES, fakeTransport([response]), {
      baseUrl: BASE_URL,
      model: MODEL,
      state: dismissedState,
    });
    expect(second.findings).toEqual([]);
    expect(second.state.dismissed[id]).toBe(1_700_000_000_000);
  });

  it("keeps suppression after the note is edited and the contradiction re-found", async () => {
    const response = responseWith([contradiction()]);
    const first = await llmAudit(AUDIT_NOTES, fakeTransport([response]), {
      baseUrl: BASE_URL,
      model: MODEL,
    });
    const id = first.findings[0]?.id ?? "";
    const dismissedState = dismissFinding(first.state, id, 1);

    const edited = AUDIT_NOTES.map((note) => ({ ...note, body: `${note.body} plus edits.`, mtime: note.mtime + 5 }));
    // Same quotes survive the edit → same id → still suppressed despite re-audit.
    const third = await llmAudit(edited, fakeTransport([response]), {
      baseUrl: BASE_URL,
      model: MODEL,
      state: dismissedState,
    });
    expect(third.auditedPaths).toEqual(["characters/Kestrel.md", "events/Fall of Vael'Thor.md"]);
    expect(third.findings).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Storage port — DI, poisoned write, never touches notes               */
/* ------------------------------------------------------------------ */

describe("runLlmAudit — injected storage port", () => {
  it("reads prior state, audits, and writes the updated state exactly once", async () => {
    const prior: AuditState = { version: 1, vaultHash: "", dismissed: {}, lastAudit: {} };
    const port = fakePort(serializeAuditState(prior));
    const notesSnapshot = JSON.parse(JSON.stringify(AUDIT_NOTES)) as Note[];
    const result = await runLlmAudit(
      AUDIT_NOTES,
      fakeTransport([EMPTY_RESPONSE]),
      port,
      { baseUrl: BASE_URL, model: MODEL },
    );
    expect(port.writes).toHaveLength(1);
    const reloaded = loadAuditState(port.writes[0] ?? null);
    expect(reloaded.lastAudit).toEqual({ "characters/Kestrel.md": 10, "events/Fall of Vael'Thor.md": 20 });
    expect(result.findings).toEqual([]);
    expect(AUDIT_NOTES).toEqual(notesSnapshot); // the vault is never mutated
  });

  it("poisoned storage: malformed output rejects with AiError and never writes state or notes", async () => {
    const poisoned: AuditStatePort = {
      read: async () => null,
      write: async () => {
        throw new Error("POISON: audit state must not be written");
      },
    };
    const notesSnapshot = JSON.parse(JSON.stringify(AUDIT_NOTES)) as Note[];
    let caught: unknown;
    try {
      await runLlmAudit(
        AUDIT_NOTES,
        fakeTransport(["model went off the rails"]),
        poisoned,
        { baseUrl: BASE_URL, model: MODEL },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiError);
    expect((caught as AiError).kind).toBe("invalid-response");
    expect(AUDIT_NOTES).toEqual(notesSnapshot); // fs-port untouched: notes unchanged
  });
});
