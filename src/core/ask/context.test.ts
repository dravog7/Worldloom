import { describe, expect, it } from "vitest";
import { estimateTokens } from "../ai/extract";
import type { AskContextItem } from "../ai/prompts";
import type { IndexProvider } from "../index/provider";
import { MemoryIndex } from "../index/memory-index";
import type { Note, SearchHit } from "../types";
import {
  buildAskContext,
  buildAskContextItems,
  DEFAULT_ASK_CONTEXT_TOKENS,
} from "./context";

function note(path: string, body: string, extra: Partial<Note> = {}): Note {
  const stem = path.replace(/\.md$/, "").split("/").pop() ?? path;
  return {
    path,
    title: stem,
    aliases: [],
    tags: [],
    relations: [],
    body,
    links: [],
    mtime: 0,
    ...extra,
  };
}

function indexed(...notes: Note[]): MemoryIndex {
  const index = new MemoryIndex();
  for (const item of notes) index.upsert(item);
  return index;
}

describe("buildAskContext", () => {
  it("renders each source as a titled block with 0-based line numbers", () => {
    const index = indexed(
      note("places/Vael'Thor.md", "A mountain citadel.\nRuled by the Synod.\nThird line here."),
    );
    const result = buildAskContext(index, "citadel");
    expect(result.empty).toBe(false);
    if (result.empty) return;
    expect(result.sources).toEqual(["places/Vael'Thor.md"]);
    expect(result.context).toContain("## Vael'Thor (places/Vael'Thor.md)");
    expect(result.context).toContain("0: A mountain citadel.");
    expect(result.context).toContain("1: Ruled by the Synod.");
    expect(result.context).toContain("2: Third line here.");
  });

  it("dedupes a note that is both a search hit and the open note", () => {
    const index = indexed(
      note("places/Vael'Thor.md", "A citadel of salt and glass."),
    );
    const result = buildAskContext(index, "citadel", "places/Vael'Thor.md");
    expect(result.empty).toBe(false);
    if (result.empty) return;
    expect(result.sources).toEqual(["places/Vael'Thor.md"]);
    const headers = result.context.match(/## /g) ?? [];
    expect(headers).toHaveLength(1);
  });

  it("includes the backlink sources of the open note with the link line", () => {
    const linking = note("ports/Salt.md", "Salt runs thin these days.\nThe council meets.\nWe met [[Vael'Thor]] at dawn.\nAfter the meeting.", {
      links: [
        { source: "ports/Salt.md", target: "Vael'Thor", line: 2 },
      ],
    });
    const index = indexed(
      note("places/Vael'Thor.md", "A citadel."),
      linking,
    );
    const result = buildAskContext(index, "unmatchedquestiontokens", "places/Vael'Thor.md");
    expect(result.empty).toBe(false);
    if (result.empty) return;
    expect(result.sources).toContain("ports/Salt.md");
    // The backlink excerpt keeps the 0-based link line so a citation is checkable.
    expect(result.context).toContain("## Salt (ports/Salt.md)");
    expect(result.context).toContain("2: We met [[Vael'Thor]] at dawn.");
    // Open note still present even when the question matches nothing.
    expect(result.sources).toContain("places/Vael'Thor.md");
  });

  it("keeps the open note as context even when the question matches no note", () => {
    const index = indexed(note("journal/Day 1.md", "Wrote three letters."));
    const result = buildAskContext(index, "zzz-no-match", "journal/Day 1.md");
    expect(result.empty).toBe(false);
    if (result.empty) return;
    expect(result.sources).toEqual(["journal/Day 1.md"]);
    expect(result.context).toContain("## Day 1 (journal/Day 1.md)");
  });

  it("signals empty when nothing matches and no open note is present", () => {
    const index = indexed(note("a.md", "alpha content"));
    const result = buildAskContext(index, "zzz-no-match");
    expect(result).toEqual({ empty: true, context: "", sources: [] });
  });

  it("signals empty when the open note path is not in the vault", () => {
    const index = indexed(note("a.md", "alpha content"));
    const result = buildAskContext(index, "zzz-no-match", "ghost/Nowhere.md");
    expect(result.empty).toBe(true);
  });

  it("ignores search hits that carry a score of 0 (stub provider)", () => {
    const stub: IndexProvider = {
      upsert: () => undefined,
      remove: () => undefined,
      byTitleOrAlias: () => [],
      backlinks: () => [],
      links: () => [],
      search: (): SearchHit[] => [
        { path: "zero.md", title: "Zero", score: 0 },
      ],
      all: () => [note("zero.md", "nothing")],
      persist: async () => undefined,
      load: async () => false,
    };
    const result = buildAskContext(stub, "anything");
    expect(result.empty).toBe(true);
  });

  it("respects the token budget, keeping higher-priority sources first", () => {
    // Two search hits plus the open note; a char-count estimator makes the
    // budget arithmetic exact and reproducible.
    const index = indexed(
      note("b-second.md", "beta line one\nbeta line two"),
      note("a-first.md", "alpha line one\nalpha line two"),
      note("open.md", "the open note body"),
    );
    const estimator = (text: string): number => text.length;
    const full = buildAskContext(index, "line", "open.md", { estimator });
    expect(full.empty).toBe(false);
    if (full.empty) return;
    // Priority: search hits (score order) before the open note.
    expect(full.sources[full.sources.length - 1]).toBe("open.md");

    // Budget = exactly the first fragment + 1 char: nothing else fits whole,
    // and the next fragment cannot even start, so it is dropped entirely.
    // ("a-first" sorts before "b-second" on the title tie-break — both hit
    // with the same score.)
    const first = `## A-First (a-first.md)\n0: alpha line one\n1: alpha line two`;
    const trimmed = buildAskContext(index, "line", "open.md", {
      maxTokens: first.length + 1,
      estimator,
    });
    expect(trimmed.empty).toBe(false);
    if (trimmed.empty) return;
    expect(trimmed.sources).toEqual(["a-first.md"]);
    expect(trimmed.context).toContain("0: alpha line one");
    expect(trimmed.context).not.toContain("b-second.md");
    expect(trimmed.context).not.toContain("open.md");
  });

  it("truncates an oversized source to the remaining budget, keeping line numbers", () => {
    const index = indexed(
      note("big.md", Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n")),
    );
    const estimator = (text: string): number => text.length;
    const result = buildAskContext(index, "line", undefined, {
      maxTokens: 120,
      estimator,
    });
    expect(result.empty).toBe(false);
    if (result.empty) return;
    expect(result.sources).toEqual(["big.md"]);
    expect(result.context).toContain("0: line 0");
    // Cut before the end of the note, but every kept line keeps its number.
    expect(result.context).not.toContain("49: line 49");
    const numbered = result.context.match(/^\d+: line \d+$/gm) ?? [];
    expect(numbered.length).toBeGreaterThan(1);
    expect(numbered.length).toBeLessThan(50);
    expect(estimator(result.context)).toBeLessThanOrEqual(120);
  });

  it("defaults the budget to 6k tokens (sanity: huge vault stays bounded)", () => {
    expect(DEFAULT_ASK_CONTEXT_TOKENS).toBe(6_000);
    const big = (name: string): Note =>
      note(name, Array.from({ length: 400 }, (_, i) => `filler ${name} ${i}`).join("\n"));
    const index = indexed(big("one.md"), big("two.md"), big("three.md"));
    const result = buildAskContext(index, "filler");
    expect(result.empty).toBe(false);
    if (result.empty) return;
    expect(estimateTokens(result.context)).toBeLessThanOrEqual(DEFAULT_ASK_CONTEXT_TOKENS);
  });
});

describe("buildAskContextItems", () => {
  it("returns prompt-ready items (excerpt with line numbers, no header)", () => {
    const index = indexed(note("a.md", "alpha zero\nalpha one"));
    const items: AskContextItem[] = buildAskContextItems(index, "alpha");
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("a.md");
    expect(items[0].excerpt).toBe("0: alpha zero\n1: alpha one");
  });

  it("returns no items when the retrieval floor is not met", () => {
    const index = indexed(note("a.md", "alpha content"));
    expect(buildAskContextItems(index, "zzz-no-match")).toEqual([]);
  });
});
