import { describe, expect, it } from "vitest";
import { parseNote } from "./index";
import { hasFrontmatterFence, parseFrontmatter } from "./frontmatter";

describe("parseNote — frontmatter v1 (ADR-002)", () => {
  it("extracts a full v1 frontmatter schema (type, aliases, tags, relations, temporal)", () => {
    const content = [
      "---",
      "type: character",
      "aliases: [Aelindra, The Exile]",
      "tags: [royalty, act1]",
      "relations:",
      "  - kind: born_in",
      "    target: Vael'Thor",
      "  - kind: allied_with",
      "    target: Halden",
      "temporal:",
      '  from: "Age of Ash"',
      '  until: "Age of Cinders"',
      "---",
      "",
      "Aelindra slipped into [[Vael'Thor]] on the night of the coronation.",
    ].join("\n");

    const note = parseNote("characters/Aelindra.md", content, 1234);

    expect(note.path).toBe("characters/Aelindra.md");
    expect(note.type).toBe("character");
    expect(note.aliases).toEqual(["Aelindra", "The Exile"]);
    expect(note.tags).toEqual(["royalty", "act1"]);
    expect(note.relations).toEqual([
      { kind: "born_in", target: "Vael'Thor" },
      { kind: "allied_with", target: "Halden" },
    ]);
    expect(note.temporal).toEqual({ from: "Age of Ash", to: "Age of Cinders" });
    expect(note.mtime).toBe(1234);
    expect(note.links).toEqual([
      {
        source: "characters/Aelindra.md",
        target: "Vael'Thor",
        line: 14,
      },
    ]);
  });

  it("parses minimal frontmatter, defaulting every missing field", () => {
    const note = parseNote("notes/min.md", "---\ntype: place\n---\nBody.\n");

    expect(note.type).toBe("place");
    expect(note.aliases).toEqual([]);
    expect(note.tags).toEqual([]);
    expect(note.relations).toEqual([]);
    expect(note.temporal).toBeUndefined();
    expect(note.links).toEqual([]);
    expect(note.mtime).toBe(0);
  });

  it("treats a note without frontmatter as body-only", () => {
    const content = "# Solo\n\nJust text with [[A Link]] in it.\n";
    const note = parseNote("notes/solo.md", content);

    expect(note.type).toBeUndefined();
    expect(note.title).toBe("Solo");
    expect(note.body).toBe(content);
    expect(note.links.map((l) => l.target)).toEqual(["A Link"]);
  });

  it("tolerates malformed YAML frontmatter without throwing (body kept as-is)", () => {
    const content = [
      "---",
      "type: [unclosed",
      "aliases: {{",
      "---",
      "",
      "# Broken but alive",
      "",
      "Text with [[A Link]] survives.",
    ].join("\n");

    let note!: ReturnType<typeof parseNote>;
    expect(() => {
      note = parseNote("notes/broken.md", content);
    }).not.toThrow();

    expect(note.type).toBeUndefined();
    expect(note.aliases).toEqual([]);
    // Treated as having no frontmatter: the whole file is the body.
    expect(note.body).toBe(content);
    expect(note.title).toBe("Broken but alive");
    expect(note.links.map((l) => l.target)).toEqual(["A Link"]);
  });

  it("normalizes scalar aliases into a single-element array", () => {
    const note = parseNote("n.md", "---\naliases: Aelindra\n---\n");
    expect(note.aliases).toEqual(["Aelindra"]);
  });

  it("keeps list aliases and drops non-string / blank entries", () => {
    const note = parseNote(
      "n.md",
      "---\naliases:\n  - Aelindra\n  - 42\n  - \"\"\n  - \"  The Exile  \"\n---\n",
    );
    expect(note.aliases).toEqual(["Aelindra", "The Exile"]);
  });

  it("skips relation entries missing a valid target or kind", () => {
    const note = parseNote(
      "n.md",
      [
        "---",
        "relations:",
        "  - kind: born_in",
        "  - target: Orphan",
        "  - kind: 7",
        "    target: Numeric kind",
        '  - "not a mapping"',
        "  - kind: rides",
        "    target: Windrunner",
        "---",
      ].join("\n"),
    );
    expect(note.relations).toEqual([{ kind: "rides", target: "Windrunner" }]);
  });

  it("maps temporal.until to Temporal.to and drops invalid temporal values", () => {
    const note = parseNote(
      "n.md",
      [
        "---",
        "temporal:",
        '  until: "Age of Cinders"',
        "  from: 12",
        "---",
      ].join("\n"),
    );
    expect(note.temporal).toEqual({ to: "Age of Cinders" });

    const none = parseNote("n2.md", "---\ntemporal:\n  from: [bad\n---\n");
    expect(none.temporal).toBeUndefined();
  });
});

describe("parseNote — wikilink extraction", () => {
  it("extracts pipe wikilinks with target and display text", () => {
    const note = parseNote(
      "n.md",
      "See [[Coronation of Halden|the coronation]] and [[Vael'Thor]].\n",
    );
    expect(note.links).toEqual([
      {
        source: "n.md",
        target: "Coronation of Halden",
        line: 0,
        display: "the coronation",
      },
      { source: "n.md", target: "Vael'Thor", line: 0 },
    ]);
  });

  it("reports 0-based line numbers for multiple links, offset by frontmatter", () => {
    const content = [
      "---",
      "tags: [a]",
      "---",
      "",
      "First [[Alpha]] here.",
      "Nothing on this line.",
      "Then [[Beta|bee]] and [[Gamma]] together.",
    ].join("\n");

    const note = parseNote("n.md", content);
    expect(note.links).toEqual([
      { source: "n.md", target: "Alpha", line: 4 },
      { source: "n.md", target: "Beta", line: 6, display: "bee" },
      { source: "n.md", target: "Gamma", line: 6 },
    ]);
  });

  it("ignores wikilinks inside ``` fenced code blocks", () => {
    const content = [
      "Before [[Real One]].",
      "```js",
      "const x = '[[Fake Block]]';",
      "```",
      "After [[Real Two]].",
    ].join("\n");

    const note = parseNote("n.md", content);
    expect(note.links.map((l) => l.target)).toEqual(["Real One", "Real Two"]);
  });

  it("ignores wikilinks inside ~~~ fenced code blocks", () => {
    const content = [
      "Start [[Real One]].",
      "~~~markdown",
      "[[Fake Tilde]]",
      "~~~",
      "End [[Real Two]].",
    ].join("\n");

    const note = parseNote("n.md", content);
    expect(note.links.map((l) => l.target)).toEqual(["Real One", "Real Two"]);
  });

  it("ignores wikilinks inside inline code spans (single and double backtick)", () => {
    const content =
      "Inline `[[Fake One]]` and double `` `[[Fake Two]]` `` still [[Real]].\n";
    const note = parseNote("n.md", content);
    expect(note.links.map((l) => l.target)).toEqual(["Real"]);
  });

  it("skips empty or blank link targets and blank display text", () => {
    const note = parseNote(
      "n.md",
      "[[]] and [[] ] and [[Real|]] and [[ Spacey ]].\n",
    );
    expect(note.links).toEqual([
      { source: "n.md", target: "Real", line: 0 },
      { source: "n.md", target: "Spacey", line: 0 },
    ]);
  });
});

describe("parseNote — title and degenerate inputs", () => {
  it("derives title from the first H1 outside code blocks, else the filename stem", () => {
    const content = [
      "```",
      "# Not A Title",
      "```",
      "## Not H1 Either",
      "# The Real Title ",
    ].join("\n");
    const note = parseNote("notes/some-file.md", content);
    expect(note.title).toBe("The Real Title");

    const fallback = parseNote("places/Vael'Thor.md", "No heading here.\n");
    expect(fallback.title).toBe("Vael'Thor");
  });

  it("preserves unicode in titles, aliases, and link targets", () => {
    const content = [
      "---",
      "aliases: [Kāli, Ünïcode ✨]",
      "---",
      "# Vael'Thör — Дварф Холл 🏔",
      "",
      "Ünïcode text referencing [[Квест Мира|путь]].",
    ].join("\n");

    const note = parseNote("notes/Kâli-описание.md", content);
    expect(note.title).toBe("Vael'Thör — Дварф Холл 🏔");
    expect(note.aliases).toEqual(["Kāli", "Ünïcode ✨"]);
    expect(note.links).toEqual([
      {
        source: "notes/Kâli-описание.md",
        target: "Квест Мира",
        line: 5,
        display: "путь",
      },
    ]);

    const stemOnly = parseNote("notes/Врата.md", "");
    expect(stemOnly.title).toBe("Врата");
  });

  it("handles an empty file", () => {
    const note = parseNote("notes/empty.md", "");
    expect(note.title).toBe("empty");
    expect(note.body).toBe("");
    expect(note.aliases).toEqual([]);
    expect(note.tags).toEqual([]);
    expect(note.relations).toEqual([]);
    expect(note.temporal).toBeUndefined();
    expect(note.links).toEqual([]);
    expect(note.mtime).toBe(0);
  });

  it("defaults mtime to 0 when omitted", () => {
    expect(parseNote("a.md", "x").mtime).toBe(0);
    expect(parseNote("a.md", "x", 99).mtime).toBe(99);
  });
});

describe("frontmatter — CRLF files (Windows checkouts and Windows-authored vaults)", () => {
  // Regression for the autocrlf find: on CRLF content the closing-fence scan
  // anchors its `^` after the \r, so the final frontmatter line reached the
  // parser with a bare trailing \r, KEY_RE could not consume it, and every
  // CRLF note fell through to the malformed→null path (aliases/tags/relations
  // silently never parsed on Windows). Pinned at parseNote level (identical
  // to the LF result) and at parseFrontmatter level (body bytes, tolerance).
  it("parses the full v1 schema from a CRLF note identically to LF", () => {
    const lines = [
      "---",
      "type: character",
      "aliases: [Aelindra, The Exile]",
      "tags: [royalty, act1]",
      "relations:",
      "  - kind: born_in",
      "    target: Vael'Thor",
      "temporal:",
      '  from: "Age of Ash"',
      '  until: "Age of Cinders"',
      "---",
      "",
      "Aelindra slipped into [[Vael'Thor]] on the night of the coronation.",
    ];
    const lf = parseNote("characters/Aelindra.md", lines.join("\n"), 1234);
    const crlf = parseNote("characters/Aelindra.md", lines.join("\r\n"), 1234);

    // Body bytes intentionally differ (CRLF preserved verbatim by contract);
    // everything else must be identical.
    expect({ ...crlf, body: null }).toEqual({ ...lf, body: null });
    expect(crlf.body).toBe(lf.body.replace(/\n/g, "\r\n"));
    expect(crlf.type).toBe("character");
    expect(crlf.aliases).toEqual(["Aelindra", "The Exile"]);
    expect(crlf.relations).toEqual([{ kind: "born_in", target: "Vael'Thor" }]);
    expect(crlf.temporal).toEqual({ from: "Age of Ash", to: "Age of Cinders" });
    expect(crlf.links).toEqual([
      { source: "characters/Aelindra.md", target: "Vael'Thor", line: 12 },
    ]);
  });

  it("parses minimal and empty CRLF frontmatter", () => {
    const minimal = parseNote("notes/min.md", "---\r\ntype: place\r\n---\r\nBody.\r\n");
    expect(minimal.type).toBe("place");
    expect(minimal.aliases).toEqual([]);

    const empty = parseFrontmatter("---\r\n---\r\nBody");
    expect(empty).not.toBeNull();
    expect(empty?.data).toEqual({});
    expect(empty?.body).toBe("Body");
  });

  it("keeps CRLF body bytes verbatim and the line offset equal to LF", () => {
    const lf = parseFrontmatter("---\ntype: session\n---\nOne\nTwo\n");
    const crlf = parseFrontmatter("---\r\ntype: session\r\n---\r\nOne\r\nTwo\r\n");
    expect(crlf).not.toBeNull();
    expect(crlf?.body).toBe("One\r\nTwo\r\n");
    expect(crlf?.lineOffset).toBe(lf?.lineOffset);
  });

  it("still falls back to null on malformed CRLF frontmatter (ADR-002 tolerance)", () => {
    expect(parseFrontmatter("---\r\nkey: {nested: 1}\r\n---\r\nBody")).toBeNull();
  });

  it("handles LF fences with a CRLF body and mixed interior endings", () => {
    const mixed = parseFrontmatter("---\ntype: session\r\naliases: [Q]\n---\nBody");
    expect(mixed).not.toBeNull();
    expect(mixed?.data).toEqual({ type: "session", aliases: ["Q"] });
  });

  it("parses classic-Mac CR-only frontmatter (link offsets assume \n endings)", () => {
    // Frontmatter parses on any line ending; the inherited lineOffset formula
    // counts \n only, so CR-only wikilink LINE numbers are not pinned here.
    const cr = parseNote("notes/old.md", "---\rtype: place\raliases: [Cr-only]\r---\rBody with [[Link]].\r");
    expect(cr.type).toBe("place");
    expect(cr.aliases).toEqual(["Cr-only"]);
    expect(cr.links.map((l) => l.target)).toEqual(["Link"]);
  });

  it("hasFrontmatterFence recognizes CRLF and CR-only fences", () => {
    expect(hasFrontmatterFence("---\r\ntype: place\r\n---\r\nBody")).toBe(true);
    expect(hasFrontmatterFence("---\rtype: place\r---\rBody")).toBe(true);
    expect(hasFrontmatterFence("# No fence\r\nBody")).toBe(false);
  });
});
