import { describe, expect, it } from "vitest";
import {
  createWikilinkCompletionSource,
  type CompletionCandidate,
  type CompletionProbe,
} from "./autocomplete";

/** Structural CM6 context stand-in — doc.sliceString + cursor pos. */
function probe(text: string, pos = text.length): CompletionProbe {
  return {
    state: {
      doc: {
        length: text.length,
        sliceString: (from: number, to?: number) => text.slice(from, to),
      },
    },
    pos,
  };
}

const CANDIDATES: CompletionCandidate[] = [
  { title: "Vael'Thor", path: "places/vael-thor.md", aliases: ["The Spire"] },
  { title: "Silver Wood", path: "places/silver-wood.md", aliases: [] },
  { title: "Valley of Ash", path: "places/valley-of-ash.md", aliases: ["Ash Valley"] },
];

/** Injected lookup that records every query it receives. */
function recordingLookup(candidates: CompletionCandidate[] = CANDIDATES) {
  const queries: string[] = [];
  const lookup = (query: string) => {
    queries.push(query);
    return candidates;
  };
  return { queries, lookup };
}

describe("createWikilinkCompletionSource — trigger detection", () => {
  it("triggers on an unclosed [[partial and spans the whole [[partial text", () => {
    const source = createWikilinkCompletionSource(() => CANDIDATES);
    const result = source(probe("[[Vael"));

    expect(result).not.toBeNull();
    expect(result?.from).toBe(0); // replaced span starts at the opening [[
    expect(result?.to).toBe(6);
  });

  it("triggers mid-line after prose text", () => {
    const source = createWikilinkCompletionSource(() => CANDIDATES);
    const result = source(probe("He ruled from [[Sil"));

    expect(result).not.toBeNull();
    expect(result?.from).toBe(14); // opening [[ at index 14
    expect(result?.to).toBe(19);
  });

  it("returns null outside a wikilink (plain prose, closed link, plain brackets)", () => {
    const source = createWikilinkCompletionSource(() => CANDIDATES);

    expect(source(probe("plain prose here"))).toBeNull();
    expect(source(probe("see [[Done]] already"))).toBeNull();
    expect(source(probe("[not a wikilink]"))).toBeNull();
    expect(source(probe(""))).toBeNull();
  });

  it("scopes the trigger to the current line (closed link above, none below)", () => {
    const source = createWikilinkCompletionSource(() => CANDIDATES);
    const result = source(probe("[[Earlier Note]]\nno wikilink on this line"));

    expect(result).toBeNull();
  });
});

describe("createWikilinkCompletionSource — lookup filtering", () => {
  it("empty [[ (no partial) queries the lookup with an empty string and lists all it returns", () => {
    const { queries, lookup } = recordingLookup();
    const source = createWikilinkCompletionSource(lookup);

    const result = source(probe("intro [["));

    expect(queries).toEqual([""]);
    expect(result?.from).toBe(6);
    expect(result?.to).toBe(8);
    expect(result?.options.map((o) => o.label)).toEqual([
      "Vael'Thor",
      "Silver Wood",
      "Valley of Ash",
    ]);
  });

  it("passes the partial title through to the injected (fuzzy-ranked) lookup", () => {
    const { queries, lookup } = recordingLookup();
    const source = createWikilinkCompletionSource(lookup);

    source(probe("[[vael"));

    expect(queries).toEqual(["vael"]);
  });

  it("returns an empty option list when the lookup finds nothing", () => {
    const source = createWikilinkCompletionSource(() => []);

    expect(source(probe("[[zzz"))).toEqual({
      from: 0,
      to: 5,
      options: [],
      filter: false,
    });
  });

  it("marks results filter: false — CM6 would fuzzy-match the bracket-inclusive span against labels and drop every option (the tooltip would never open)", () => {
    const source = createWikilinkCompletionSource(() => CANDIDATES);

    const result = source(probe("[[Sil"));

    expect(result?.filter).toBe(false);
  });

  it("deduplicates candidates sharing a title (alias collisions)", () => {
    const source = createWikilinkCompletionSource(() => [
      { title: "Vael'Thor", path: "places/vael-thor.md", aliases: [] },
      { title: "Vael'Thor", path: "archive/vael-thor-old.md", aliases: ["Old Spire"] },
    ]);

    const result = source(probe("[[Vael"));

    expect(result?.options).toHaveLength(1);
    expect(result?.options[0]?.apply).toBe("[[Vael'Thor]]");
  });
});

describe("createWikilinkCompletionSource — accept payload", () => {
  it("builds options whose label is the title and apply inserts [[Title]]", () => {
    const source = createWikilinkCompletionSource(() => CANDIDATES);

    const result = source(probe("[[vael"));

    expect(result?.options[0]).toEqual({
      label: "Vael'Thor",
      detail: "places/vael-thor.md",
      apply: "[[Vael'Thor]]",
    });
  });

  it("accepting replaces the whole [[partial span with [[Title]]", () => {
    const source = createWikilinkCompletionSource(() => CANDIDATES);
    const text = "He ruled [[Vael";
    const result = source(probe(text));

    expect(result).not.toBeNull();
    const from = result?.from ?? -1;
    const to = result?.to ?? -1;
    const replaced = text.slice(0, from) + (result?.options[0]?.apply ?? "") + text.slice(to);
    expect(replaced).toBe("He ruled [[Vael'Thor]]");
  });
});
