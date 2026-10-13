/**
 * M2 Wave D2 — headless findings flow (PLAN-M2 §D2): rules findings →
 * panel model (buildFindingRows) → dismiss via tombstone → suppressed on
 * rebuild; plus the pre-run cost fixture, the panel-local UI store, and a
 * renderToString smoke of the thin FindingsPanel shell (no @testing-library
 * in this repo; node env, createElement only).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DEFAULT_AI_SETTINGS } from "../core/ai/settings";
import {
  buildFindingRows,
  estimateAuditCost,
  planAuditPass,
  type AuditPassPlan,
} from "../core/audit/findings-view";
import {
  dismissFinding,
  emptyAuditState,
  isDismissed,
  loadAuditState,
  mergeAuditFindings,
  serializeAuditState,
  vaultFingerprint,
  type AuditStatePort,
  type LlmFinding,
} from "../core/audit/llm";
import { auditRules } from "../core/audit/rules";
import { estimateCostUsd } from "../core/ai/settings";
import { FakeIndex, makeNote } from "../core/vault/test-fakes";
import { FindingsPanel, type FindingsPanelProps } from "./FindingsPanel";
import { createFindingsUiStore, initialFindingsUiState } from "./findings-store";

/** In-memory AuditStatePort fake (one JSON string, D1 contract). */
class MemoryAuditStatePort implements AuditStatePort {
  raw: string | null = null;
  async read(): Promise<string | null> {
    return this.raw;
  }
  async write(serialized: string): Promise<void> {
    this.raw = serialized;
  }
}

/** Seeded vault: one duplicate alias + one missing relation + one dead link. */
function seededIndex(): FakeIndex {
  const index = new FakeIndex();
  index.upsert(
    makeNote("people/Ellara.md", {
      title: "Ellara",
      aliases: ["The Tideborn"],
      body: "Captain of the Meridian.",
      mtime: 100,
    }),
  );
  index.upsert(
    makeNote("people/Ellara-of-the-Sea.md", {
      title: "Ellara",
      body: "A different Ellara entirely.",
      mtime: 101,
    }),
  );
  index.upsert(
    makeNote("places/Vael'Thor.md", {
      title: "Vael'Thor",
      relations: [{ kind: "ruler", target: "Ghost Queen" }],
      links: [{ source: "places/Vael'Thor.md", target: "The Unmade", line: 3 }],
      body: "The drowned city.\nSee [[The Unmade]].",
      mtime: 102,
    }),
  );
  return index;
}

describe("findings flow: rules → rows → dismiss → suppressed on rebuild", () => {
  it("runs the full headless loop through a port-backed tombstone", async () => {
    const index = seededIndex();
    const port = new MemoryAuditStatePort();
    const notes = index.all();

    // 1. Rules pass (offline) — finds the seeded structural findings.
    const rules = auditRules(index);
    expect(rules.map((f) => f.kind).sort()).toEqual([
      "dead-link",
      "duplicate-alias",
      "missing-relation-target",
    ]);

    // 2. Panel model: everything visible, groups collapsed.
    let state = { ...emptyAuditState(vaultFingerprint(notes)) };
    let rows = buildFindingRows(mergeAuditFindings(rules, []), {
      auditState: state,
      expanded: new Set<string>(),
    });
    const before = rows.flatMap((group) => group.findings.map((row) => row.id));
    expect(before).toHaveLength(3);

    // 3. Dismiss the first finding: tombstone through the port, atomically
    //    visible only after the write succeeds.
    const dismissedId = before[0] as string;
    state = dismissFinding(state, dismissedId, 1_700_000_000_000);
    await port.write(serializeAuditState(state));

    // 4. Re-audit with the same vault: the rules STILL report the finding
    //    (identity is content-hash stable), but the tombstone suppresses it.
    const rerun = mergeAuditFindings(auditRules(index), []);
    expect(rerun.some((finding) => finding.id === dismissedId)).toBe(true);
    const reloaded = loadAuditState(await port.read());
    expect(isDismissed(reloaded, dismissedId)).toBe(true);
    rows = buildFindingRows(rerun, { auditState: reloaded, expanded: new Set<string>() });
    const after = rows.flatMap((group) => group.findings.map((row) => row.id));
    expect(after).toHaveLength(2);
    expect(after).not.toContain(dismissedId);

    // 5. Corrupt state never throws — worst case is a full re-audit.
    expect(loadAuditState("{not json").dismissed).toEqual({});
  });

  it("cost estimate fixture matches independent math from the same plan", () => {
    const index = seededIndex();
    const notes = index.all();
    const plan = planAuditPass(notes, emptyAuditState(vaultFingerprint(notes)));
    expect(plan.batches).toBeGreaterThan(0);

    const cost = estimateAuditCost(notes.length, plan.batches, {
      priceInputPerM: 2.5,
      priceOutputPerM: 10,
      tokensPerBatch: plan.tokensPerBatch,
    });
    const inputUsd = estimateCostUsd(plan.totalInputTokens, 2.5);
    expect(cost.inputUsd).toBeCloseTo(inputUsd, 12);
    expect(cost.totalUsd).toBeCloseTo(
      inputUsd + estimateCostUsd(plan.batches * 1_000, 10),
      12,
    );
  });
});

describe("findings UI store (panel-local only)", () => {
  it("tracks running/progress/expansion and resets cleanly; instances are isolated", () => {
    const store = createFindingsUiStore();
    // Match the state subset — the store object also carries its actions.
    expect(store.getState()).toMatchObject(initialFindingsUiState);

    store.getState().setRunning(true);
    store.getState().setProgress(2, 5);
    store.getState().toggleGroup("a.md");
    store.getState().toggleGroup("a.md");
    store.getState().toggleGroup("b.md");
    expect(store.getState().running).toBe(true);
    expect(store.getState().progressDone).toBe(2);
    expect(store.getState().progressTotal).toBe(5);
    expect([...store.getState().expanded]).toEqual(["b.md"]);

    store.getState().bumpRefresh();
    expect(store.getState().refreshCounter).toBe(1);
    store.getState().reset();
    expect(store.getState()).toMatchObject(initialFindingsUiState);

    // Isolation: a second store shares nothing with the first.
    const other = createFindingsUiStore();
    other.getState().toggleGroup("z.md");
    expect(store.getState().expanded.size).toBe(0);
  });

  it("carries paid LLM findings, the plan, and hasRun across remounts; reset clears all (M2 I4 #2)", () => {
    const store = createFindingsUiStore();
    const finding: LlmFinding = {
      id: "llm-1",
      kind: "llm-contradiction",
      noteA: "a.md",
      lineA: 0,
      quoteA: "quote A",
      noteB: "b.md",
      lineB: 0,
      quoteB: "quote B",
      message: "contradiction",
    };
    const plan: AuditPassPlan = {
      pendingNotes: [],
      batches: 1,
      totalInputTokens: 120,
      tokensPerBatch: 120,
    };

    store.getState().setFindings([finding]);
    store.getState().setAuditPlan(plan, { inputUsd: 0.001, totalUsd: 0.002 });
    store.getState().setHasRun(true);
    expect(store.getState().findings).toEqual([finding]);
    expect(store.getState().plan).toEqual(plan);
    expect(store.getState().estimate).toEqual({ inputUsd: 0.001, totalUsd: 0.002 });
    expect(store.getState().hasRun).toBe(true);

    store.getState().reset();
    expect(store.getState().findings).toEqual([]);
    expect(store.getState().plan).toBeNull();
    expect(store.getState().estimate).toBeNull();
    expect(store.getState().hasRun).toBe(false);
  });
});

describe("FindingsPanel (thin shell, SSR smoke)", () => {
  it("renders the run button, the unconfigured LLM note, and the empty state", () => {
    const index = seededIndex();
    const props: FindingsPanelProps = {
      provider: index,
      auditStatePort: new MemoryAuditStatePort(),
      aiSettings: DEFAULT_AI_SETTINGS, // openai preset, no key → gate note shows
      onOpenNote: () => {},
    };
    const html = renderToString(createElement(FindingsPanel, props));
    expect(html).toContain("Run audit");
    expect(html).toContain("LLM pass needs an API key — rules pass still works");
    expect(html).toContain("No contradictions found.");
  });

  it("disables the run button without a vault", () => {
    const props: FindingsPanelProps = {
      provider: null,
      auditStatePort: new MemoryAuditStatePort(),
      aiSettings: DEFAULT_AI_SETTINGS,
      onOpenNote: () => {},
    };
    const html = renderToString(createElement(FindingsPanel, props));
    expect(html).toContain("disabled");
  });
});
