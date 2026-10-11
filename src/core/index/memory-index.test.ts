import { describe, expect, it } from "vitest";
import type { Note, Relation } from "../types";
import type { IndexProvider } from "./provider";
import { MemoryIndex } from "./memory-index";
import { MemoryIndexStorage } from "./storage";

function makeNote(overrides: Partial<Note> & { path: string }): Note {
  return {
    title: overrides.path.replace(/\.md$/u, ""),
    aliases: [],
    tags: [],
    relations: [],
    body: "",
    links: [],
    mtime: 0,
    ...overrides,
  };
}

describe("MemoryIndex — insert & lookup", () => {
  it("upsert adds a note retrievable via all(), sorted by path", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "b.md", title: "Bravo" }));
    index.upsert(makeNote({ path: "a.md", title: "Alpha" }));

    const all = index.all();
    expect(all.map((n) => n.path)).toEqual(["a.md", "b.md"]);
    expect(all[0]?.title).toBe("Alpha");
  });

  it("upsert replaces the note stored under the same path", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "a.md", title: "Old Title", aliases: ["Oldie"] }));
    index.upsert(makeNote({ path: "a.md", title: "New Title", aliases: ["Newie"] }));

    expect(index.all()).toHaveLength(1);
    expect(index.byTitleOrAlias("Old Title")).toEqual([]);
    expect(index.byTitleOrAlias("Oldie")).toEqual([]);
    expect(index.byTitleOrAlias("Newie").map((n) => n.path)).toEqual(["a.md"]);
  });

  it("byTitleOrAlias resolves an exact title, case-insensitively", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "places/vael-thor.md", title: "Vael'Thor" }));

    expect(index.byTitleOrAlias("vael'thor").map((n) => n.path)).toEqual([
      "places/vael-thor.md",
    ]);
    expect(index.byTitleOrAlias("VAEL'THOR").map((n) => n.path)).toEqual([
      "places/vael-thor.md",
    ]);
  });

  it("byTitleOrAlias resolves an alias to the canonical note, case-insensitively", () => {
    const index = new MemoryIndex();
    index.upsert(
      makeNote({
        path: "places/silver-wood.md",
        title: "Silver Wood",
        aliases: ["The Shimmering Forest", "Glimmerwood"],
      }),
    );

    const hits = index.byTitleOrAlias("glimmerWOOD");
    expect(hits.map((n) => n.path)).toEqual(["places/silver-wood.md"]);
    expect(hits[0]?.title).toBe("Silver Wood");
  });
});

describe("MemoryIndex — fuzzy byTitleOrAlias ranking", () => {
  it("ranks exact > prefix > subsequence, then by title length and alphabet", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "art.md", title: "Art" }));
    index.upsert(makeNote({ path: "artist.md", title: "Artist" }));
    index.upsert(makeNote({ path: "art-of-war.md", title: "Art of War" }));
    index.upsert(makeNote({ path: "random-tale.md", title: "A Random Tale" }));

    expect(index.byTitleOrAlias("art").map((n) => n.title)).toEqual([
      "Art", // exact
      "Artist", // prefix, shorter title
      "Art of War", // prefix, longer title
      "A Random Tale", // subsequence (a-r-t ordered, not contiguous)
    ]);
  });

  it("subsequence matching requires ordered characters, not any letters", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "rat-tales.md", title: "Rat Tales" }));

    // a(1) then r? no r after index 1 — must NOT match "art".
    expect(index.byTitleOrAlias("art")).toEqual([]);
    expect(index.byTitleOrAlias("rat").map((n) => n.title)).toEqual(["Rat Tales"]);
  });

  it("returns empty for empty or whitespace-only queries", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "a.md", title: "Alpha" }));

    expect(index.byTitleOrAlias("")).toEqual([]);
    expect(index.byTitleOrAlias("   ")).toEqual([]);
  });
});

describe("MemoryIndex — edges from links and relations", () => {
  it("derives typed edges from wikilinks and frontmatter relations with provenance", () => {
    const relations: Relation[] = [
      { kind: "ally", target: "Hero" },
      { kind: "rival", target: "The Usurper" },
    ];
    const index = new MemoryIndex();
    index.upsert(
      makeNote({
        path: "a.md",
        title: "Alpha",
        relations,
        links: [
          { source: "a.md", target: "Target", line: 4, display: "the target" },
          { source: "a.md", target: "Nowhere", line: 9 },
        ],
      }),
    );

    const edges = index.edges("a.md");
    expect(edges).toEqual([
      {
        source: "a.md",
        target: "Target",
        kind: "",
        provenance: "link",
        line: 4,
        display: "the target",
      },
      { source: "a.md", target: "Nowhere", kind: "", provenance: "link", line: 9 },
      { source: "a.md", target: "Hero", kind: "ally", provenance: "relation", line: -1 },
      {
        source: "a.md",
        target: "The Usurper",
        kind: "rival",
        provenance: "relation",
        line: -1,
      },
    ]);
  });

  it("backlinks resolve link targets by title and vanish with their source note", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "a.md", title: "Target" }));
    index.upsert(
      makeNote({
        path: "b.md",
        title: "Bravo",
        links: [
          { source: "b.md", target: "Target", line: 2, display: "T" },
          { source: "b.md", target: "Nowhere", line: 5 },
        ],
      }),
    );

    expect(index.backlinks("a.md")).toEqual([
      { source: "b.md", target: "Target", line: 2, display: "T" },
    ]);
    expect(index.links("b.md")).toEqual([
      { source: "b.md", target: "Target", line: 2, display: "T" },
      { source: "b.md", target: "Nowhere", line: 5 },
    ]);

    index.remove("b.md");
    expect(index.backlinks("a.md")).toEqual([]);
  });

  it("a link resolves once its target note is upserted later (lazy backlinks)", () => {
    const index = new MemoryIndex();
    index.upsert(
      makeNote({ path: "b.md", title: "Bravo", links: [{ source: "b.md", target: "Late", line: 0 }] }),
    );
    expect(index.backlinks("x.md")).toEqual([]);

    index.upsert(makeNote({ path: "late.md", title: "Late" }));
    expect(index.backlinks("late.md")).toEqual([
      { source: "b.md", target: "Late", line: 0 },
    ]);
  });
});

describe("MemoryIndex — search", () => {
  it("token search is AND across tokens", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "both.md", title: "Both", body: "a dragon and a lore tome" }));
    index.upsert(makeNote({ path: "one.md", title: "One", body: "only a dragon here" }));

    const hits = index.search("dragon lore");
    expect(hits.map((h) => h.path)).toEqual(["both.md"]);
  });

  it("exact-phrase match is boosted above scattered tokens", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "scattered.md", title: "Scattered", body: "silver dust and a bronze axe" }));
    index.upsert(makeNote({ path: "phrase.md", title: "Phrase", body: "the silver axe gleamed" }));

    const hits = index.search("silver axe");
    expect(hits.map((h) => h.path)).toEqual(["phrase.md", "scattered.md"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it("title hits are boosted over body-only hits", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "body.md", title: "Keeper", body: "an old grimoire rests here" }));
    index.upsert(makeNote({ path: "title.md", title: "Grimoire", body: "it rests here too" }));

    const hits = index.search("grimoire");
    expect(hits.map((h) => h.path)).toEqual(["title.md", "body.md"]);
  });

  it("tokenizes unicode text — letters kept, case-insensitive", () => {
    const index = new MemoryIndex();
    index.upsert(
      makeNote({ path: "u1.md", title: "Drakkarî", body: "Ünïcødé väles tarina lohikäärme" }),
    );
    index.upsert(makeNote({ path: "u2.md", title: "Plain", body: "nothing here" }));

    expect(index.search("välës").map((h) => h.path)).toEqual([]);
    expect(index.search("VÄLES").map((h) => h.path)).toEqual(["u1.md"]);
    expect(index.search("dRAKKARÎ").map((h) => h.path)).toEqual(["u1.md"]);
    expect(index.search("lohikäärme").map((h) => h.path)).toEqual(["u1.md"]);
  });

  it("empty or punctuation-only query returns no hits", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "a.md", title: "Alpha", body: "beta gamma" }));

    expect(index.search("")).toEqual([]);
    expect(index.search("   ")).toEqual([]);
    expect(index.search("!!! --- ???")).toEqual([]);
  });

  it("snippets center on the first matching token", () => {
    const index = new MemoryIndex();
    index.upsert(
      makeNote({
        path: "a.md",
        title: "Alpha",
        body: `${"filler ".repeat(20)}the observatory collapses at dawn ${"tail ".repeat(20)}`,
      }),
    );

    const [hit] = index.search("observatory");
    expect(hit?.snippet).toBeDefined();
    expect(hit!.snippet!.toLowerCase()).toContain("observatory");
    expect(hit!.snippet!.length).toBeLessThan(120);
    expect(hit!.snippet!.startsWith("…")).toBe(true);
  });

  it("remove deletes the note from search, lookup and all()", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "a.md", title: "Alpha", body: "beta" }));
    index.remove("a.md");

    expect(index.all()).toEqual([]);
    expect(index.search("beta")).toEqual([]);
    expect(index.byTitleOrAlias("alpha")).toEqual([]);
    index.remove("never-existed.md"); // idempotent, must not throw
  });
});

describe("MemoryIndex — persistence", () => {
  it("persist→load roundtrip preserves notes, aliases, search and backlinks", async () => {
    const storage = new MemoryIndexStorage();
    const source = new MemoryIndex({ vaultHash: "hash-1", storage });
    source.upsert(makeNote({ path: "a.md", title: "Alpha", aliases: ["First"], body: "beta gamma" }));
    source.upsert(
      makeNote({
        path: "b.md",
        title: "Bravo",
        links: [{ source: "b.md", target: "Alpha", line: 3 }],
      }),
    );
    await source.persist();

    const restored = new MemoryIndex({ vaultHash: "hash-1", storage });
    expect(await restored.load()).toBe(true);

    expect(restored.all()).toEqual(source.all());
    expect(restored.byTitleOrAlias("FIRST").map((n) => n.path)).toEqual(["a.md"]);
    expect(restored.search("beta").map((h) => h.path)).toEqual(["a.md"]);
    expect(restored.backlinks("a.md")).toEqual([
      { source: "b.md", target: "Alpha", line: 3 },
    ]);
  });

  it("load() returns false when storage has no sidecar (missing file)", async () => {
    const index = new MemoryIndex({ storage: new MemoryIndexStorage() });
    expect(await index.load()).toBe(false);
  });

  it("load() returns false on corrupt JSON and keeps existing state", async () => {
    const storage = new MemoryIndexStorage();
    await storage.write("{not json[");
    const index = new MemoryIndex({ vaultHash: "h", storage });
    index.upsert(makeNote({ path: "keep.md", title: "Keep" }));

    expect(await index.load()).toBe(false);
    expect(index.all().map((n) => n.path)).toEqual(["keep.md"]);
  });

  it("load() returns false on vaultHash mismatch and keeps existing state", async () => {
    const storage = new MemoryIndexStorage();
    const source = new MemoryIndex({ vaultHash: "vault-A", storage });
    source.upsert(makeNote({ path: "a.md", title: "Alpha" }));
    await source.persist();

    const other = new MemoryIndex({ vaultHash: "vault-B", storage });
    other.upsert(makeNote({ path: "keep.md", title: "Keep" }));
    expect(await other.load()).toBe(false);
    expect(other.all().map((n) => n.path)).toEqual(["keep.md"]);
  });

  it("load() returns false on unsupported sidecar version", async () => {
    const storage = new MemoryIndexStorage();
    await storage.write(JSON.stringify({ version: 99, vaultHash: "h", notes: [], edges: [] }));
    const index = new MemoryIndex({ vaultHash: "h", storage });

    expect(await index.load()).toBe(false);
  });
});

describe("MemoryIndex — determinism", () => {
  it("duplicate aliases across notes resolve deterministically", () => {
    const index = new MemoryIndex();
    index.upsert(makeNote({ path: "z.md", title: "Zulu", aliases: ["Hero"] }));
    index.upsert(makeNote({ path: "a.md", title: "Alfa", aliases: ["hero"] }));

    // Both resolve (alias tolerated); order by title length then alphabet then path.
    expect(index.byTitleOrAlias("HERO").map((n) => n.path)).toEqual(["a.md", "z.md"]);
  });
});

describe("MemoryIndex — benchmarks (1000 synthetic notes)", () => {
  function buildSyntheticVault(count: number): Note[] {
    const subjects = ["dragon", "sword", "throne", "harbor", "grimoire", "prophecy", "citadel"];
    const notes: Note[] = [];
    for (let i = 0; i < count; i++) {
      const subject = subjects[i % subjects.length]!;
      const realm = `realm${i % 50}`;
      notes.push(
        makeNote({
          path: `notes/${realm}/note-${i}.md`,
          title: `Note ${i} of ${realm}`,
          aliases: i % 10 === 0 ? [`alias-${i}`] : [],
          tags: [subject],
          body: `In ${realm} the ${subject} stirs. lore chapter${i} ünïcødé-${i % 7}. `.repeat(3),
        }),
      );
    }
    return notes;
  }

  it("average of 100 searches stays under 50ms", () => {
    const index = new MemoryIndex();
    for (const note of buildSyntheticVault(1000)) index.upsert(note);

    const queries = [
      "dragon",
      "sword lore",
      "throne realm7",
      "grimoire prophecy",
      "chapter999",
      "ünïcødé-3",
      "note 42 of realm9",
      "citadel stirs",
      "alias-500",
      "nonexistentterm",
    ];
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      index.search(queries[i % queries.length]!);
    }
    const average = (performance.now() - start) / 100;

    expect(average).toBeLessThan(50);
  });

  it("persist→load roundtrip of 1000 notes stays under 2s", async () => {
    const storage = new MemoryIndexStorage();
    const source = new MemoryIndex({ vaultHash: "bench", storage });
    for (const note of buildSyntheticVault(1000)) source.upsert(note);

    const start = performance.now();
    await source.persist();
    const restored = new MemoryIndex({ vaultHash: "bench", storage });
    const ok = await restored.load();
    const elapsed = performance.now() - start;

    expect(ok).toBe(true);
    expect(restored.all()).toHaveLength(1000);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("MemoryIndex — contract", () => {
  it("satisfies the committed IndexProvider interface", () => {
    const index: IndexProvider = new MemoryIndex();
    expect(typeof index.upsert).toBe("function");
    expect(typeof index.load).toBe("function");
  });
});
