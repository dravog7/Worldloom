import { describe, expect, it } from "vitest";
import { EditorSelection, Text, type SelectionRange } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { DecorationSet, type Decoration } from "@codemirror/view";
import { computeDecorations } from "./decorations";

/**
 * ADR-005 live-preview decorations: markdown stays the storage bytes; syntax
 * is hidden via replace decorations and styled via marks. A construct keeps
 * its raw syntax visible only when the caret is inside it (inclusive), or
 * when a selection partially cuts it (docs/DISCOVERY-editor-models.md §3–§4,
 * construct-scoped reveal) — never merely because it shares a line with the
 * cursor, and never because it is selected.
 *
 * The tests observe the DecorationSet structurally: CM6 RangeValue startSide/
 * endSide values distinguish line (±-2e8) / replace / mark ranges, and widgets
 * carry a public `label` for identity.
 */

const parser = markdownLanguage.parser;

type Kind = "line" | "mark" | "replace" | "widget";

interface Observed {
  kind: Kind;
  from: number;
  to: number;
  cls: string | null;
  widget: string | null;
}

/** CM6 assigns line decorations startSide/endSide of -200000000. */
const LINE_SIDE = -200_000_000;
/** Bare (widget-less) replace decorations start at 499999999. */
const REPLACE_SIDE = 499_999_999;

function classify(value: Decoration): Kind {
  if (value.startSide === LINE_SIDE && value.endSide === LINE_SIDE) return "line";
  const spec = value.spec as { widget?: unknown };
  if (spec.widget !== undefined) return "widget";
  return value.startSide === REPLACE_SIDE ? "replace" : "mark";
}

function observed(set: DecorationSet): Observed[] {
  const out: Observed[] = [];
  for (const iter = set.iter(); iter.value; iter.next()) {
    const spec = iter.value.spec as {
      class?: string;
      widget?: { label?: string };
    };
    out.push({
      kind: classify(iter.value),
      from: iter.from,
      to: iter.to,
      cls: spec.class ?? null,
      widget: spec.widget ? String(spec.widget.label) : null,
    });
  }
  return out;
}

function decor(
  text: string,
  selections: readonly SelectionRange[] = [],
): Observed[] {
  const doc = Text.of(text.split("\n"));
  return observed(computeDecorations(doc, parser.parse(text).topNode, selections));
}

/** Only the replace/widget decorations (the hidden raw-syntax spans). */
function hidden(obs: Observed[]): Observed[] {
  return obs.filter((o) => o.kind === "replace" || o.kind === "widget");
}

describe("computeDecorations — headings", () => {
  it("hides the ATX hash prefix and marks the line as h1", () => {
    const obs = decor("# Title\n\nBody");
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-h1", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 1, cls: null, widget: null });
    // Only the hash is hidden — the title text stays real bytes.
    expect(hidden(obs)).toHaveLength(1);
  });

  it("maps h2 and h3 to wl-md-h2 / wl-md-h3 with their hashes collapsed", () => {
    const obs = decor("## Two\n\n### Three");
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-h2", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 2, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "line", from: 8, to: 8, cls: "wl-md-h3", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 8, to: 11, cls: null, widget: null });
  });

  it("renders the hashes as a dim raw-syntax widget while the caret is inside the heading", () => {
    const obs = decor("# Title", [EditorSelection.cursor(3)]);
    expect(obs).toContainEqual({ kind: "widget", from: 0, to: 1, cls: null, widget: "#" });
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-h1", widget: null });
  });

  it("keeps the hashes visible for a caret at the heading line's end (inclusive edge)", () => {
    const obs = decor("# Title", [EditorSelection.cursor(7)]);
    expect(obs).toContainEqual({ kind: "widget", from: 0, to: 1, cls: null, widget: "#" });
    expect(obs.some((o) => o.kind === "replace" && o.from === 0)).toBe(false);
  });

  it("a selection over the heading reveals nothing (Word-like)", () => {
    const obs = decor("# Title", [EditorSelection.range(0, 7)]);
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 1, cls: null, widget: null });
    expect(obs.some((o) => o.kind === "widget")).toBe(false);
  });
});

describe("computeDecorations — inline styling", () => {
  it("hides the ** markers and wraps the content in wl-md-strong", () => {
    const obs = decor("say **loud** now");
    expect(obs).toContainEqual({ kind: "replace", from: 4, to: 6, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 10, to: 12, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 6, to: 10, cls: "wl-md-strong", widget: null });
  });

  it("hides the * markers and wraps the content in wl-md-em", () => {
    const obs = decor("say *soft* now");
    expect(obs).toContainEqual({ kind: "replace", from: 4, to: 5, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 9, to: 10, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 5, to: 9, cls: "wl-md-em", widget: null });
  });

  it("hides the inline-code backticks and wraps the content in wl-md-code", () => {
    const obs = decor("run `npm i` now");
    expect(obs).toContainEqual({ kind: "replace", from: 4, to: 5, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 10, to: 11, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 5, to: 10, cls: "wl-md-code", widget: null });
  });

  it("reveals the markers of the bold span the caret is inside (class styling stays)", () => {
    const obs = decor("say **loud** now", [EditorSelection.cursor(8)]);
    expect(hidden(obs)).toEqual([]);
    expect(obs).toContainEqual({ kind: "mark", from: 6, to: 10, cls: "wl-md-strong", widget: null });
  });

  it("keeps a construct hidden when the caret is outside it, even on the same line", () => {
    const obs = decor("say **loud** now", [EditorSelection.cursor(1)]);
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 4, to: 6, cls: null, widget: null },
      { kind: "replace", from: 10, to: 12, cls: null, widget: null },
    ]);
  });

  it("a selection fully inside a construct reveals nothing", () => {
    const obs = decor("say **loud** now", [EditorSelection.range(6, 10)]);
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 4, to: 6, cls: null, widget: null },
      { kind: "replace", from: 10, to: 12, cls: null, widget: null },
    ]);
  });

  it("a partial-cut selection reveals only the construct it cuts (the other stays hidden)", () => {
    const text = "one **aaa** two **bbb** three";
    // Selection head lands strictly inside the first span's closing `**`,
    // its tail outside: only the first span is cut → only it reveals.
    const obs = decor(text, [EditorSelection.range(9, 14)]);
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 16, to: 18, cls: null, widget: null },
      { kind: "replace", from: 21, to: 23, cls: null, widget: null },
    ]);
    // Both styled spans keep their class marks either way.
    expect(obs).toContainEqual({ kind: "mark", from: 6, to: 9, cls: "wl-md-strong", widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 18, to: 21, cls: "wl-md-strong", widget: null });
  });

  it("a fully-selected span stays hidden (selection never reveals)", () => {
    const text = "one **aaa** two **bbb** three";
    const obs = decor(text, [EditorSelection.range(15, 24)]); // contains the second span
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 4, to: 6, cls: null, widget: null },
      { kind: "replace", from: 9, to: 11, cls: null, widget: null },
      { kind: "replace", from: 16, to: 18, cls: null, widget: null },
      { kind: "replace", from: 21, to: 23, cls: null, widget: null },
    ]);
  });

  it("a caret between two constructs on one line reveals neither", () => {
    const obs = decor("**bold** text *em*", [EditorSelection.cursor(11)]);
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 0, to: 2, cls: null, widget: null },
      { kind: "replace", from: 6, to: 8, cls: null, widget: null },
      { kind: "replace", from: 14, to: 15, cls: null, widget: null },
      { kind: "replace", from: 17, to: 18, cls: null, widget: null },
    ]);
  });
});

describe("computeDecorations — wikilinks", () => {
  it("styles [[target]] as a chip with both brackets hidden", () => {
    const obs = decor("see [[Note]] ok");
    expect(obs).toContainEqual({ kind: "mark", from: 4, to: 12, cls: "wl-md-wikilink", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 4, to: 6, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 10, to: 12, cls: null, widget: null });
  });

  it("[[target|display]] hides the target part and keeps the display text", () => {
    const obs = decor("[[Note|Alias]]");
    expect(obs).toContainEqual({ kind: "mark", from: 0, to: 14, cls: "wl-md-wikilink", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 2, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 2, to: 7, cls: null, widget: null }); // "Note|"
    expect(obs).toContainEqual({ kind: "replace", from: 12, to: 14, cls: null, widget: null });
  });

  it("a caret inside the wikilink reveals only that wikilink (chip class stays)", () => {
    const obs = decor("[[Note]]", [EditorSelection.cursor(4)]);
    expect(obs.filter((o) => o.kind === "mark")).toEqual([
      { kind: "mark", from: 0, to: 8, cls: "wl-md-wikilink", widget: null },
    ]);
    expect(hidden(obs)).toEqual([]);
  });

  it("a caret inside a wikilink keeps a bold span on the same line hidden", () => {
    const obs = decor("[[Note]] and **bold**", [EditorSelection.cursor(4)]);
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 13, to: 15, cls: null, widget: null },
      { kind: "replace", from: 19, to: 21, cls: null, widget: null },
    ]);
    expect(obs).toContainEqual({ kind: "mark", from: 0, to: 8, cls: "wl-md-wikilink", widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 15, to: 19, cls: "wl-md-strong", widget: null });
  });

  it("a caret inside bold keeps a wikilink on the same line chip-hidden", () => {
    const obs = decor("say **loud** and [[Note]] ok", [EditorSelection.cursor(8)]);
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 17, to: 19, cls: null, widget: null },
      { kind: "replace", from: 23, to: 25, cls: null, widget: null },
    ]);
    expect(obs).toContainEqual({ kind: "mark", from: 6, to: 10, cls: "wl-md-strong", widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 17, to: 25, cls: "wl-md-wikilink", widget: null });
  });
});

describe("computeDecorations — block constructs", () => {
  it("marks quote lines with wl-md-quote and hides each > marker", () => {
    const obs = decor("> quoted\n> more");
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-quote", widget: null });
    expect(obs).toContainEqual({ kind: "line", from: 9, to: 9, cls: "wl-md-quote", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 1, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 9, to: 10, cls: null, widget: null });
  });

  it("reveals every > marker while the caret is anywhere in the quote block", () => {
    const obs = decor("> quoted\n> more", [EditorSelection.cursor(3)]);
    expect(hidden(obs)).toEqual([]);
    expect(obs.filter((o) => o.kind === "line")).toHaveLength(2);
  });

  it("keeps the > marker hidden when the caret is outside the quote block", () => {
    const obs = decor("> quoted\n\nbody", [EditorSelection.cursor(12)]);
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 1, cls: null, widget: null });
  });

  it("collapses a bullet marker to a dim • widget", () => {
    const obs = decor("- item");
    expect(obs).toContainEqual({ kind: "widget", from: 0, to: 1, cls: null, widget: "•" });
    expect(obs.filter((o) => o.kind === "line")).toEqual([]);
  });

  it("reveals the raw bullet marker for a caret on it", () => {
    expect(decor("- item", [EditorSelection.cursor(0)])).toEqual([]);
  });

  it("reveals the bullet for a caret anywhere in the item (typing at its end)", () => {
    expect(decor("- item", [EditorSelection.cursor(4)])).toEqual([]);
    expect(decor("- item", [EditorSelection.cursor(6)])).toEqual([]);
  });

  it("keeps the bullet collapsed when the caret is in a different item", () => {
    const obs = decor("- item\n- other", [EditorSelection.cursor(8)]);
    expect(obs).toContainEqual({ kind: "widget", from: 0, to: 1, cls: null, widget: "•" });
    expect(obs.some((o) => o.kind !== "line" && o.from >= 7)).toBe(false);
  });

  it("replaces a horizontal-rule line with a styled rule element", () => {
    const obs = decor("text\n\n---\n\nmore");
    expect(obs).toContainEqual({ kind: "widget", from: 6, to: 9, cls: null, widget: "—" });
  });

  it("reveals the raw rule for a caret on it", () => {
    const obs = decor("text\n\n---\n\nmore", [EditorSelection.cursor(7)]);
    expect(obs.some((o) => o.widget === "—")).toBe(false);
  });

  it("styles every fenced-code line and collapses the fence delimiters", () => {
    const obs = decor("```js\nconst x = 1;\n```");
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-fenced", widget: null });
    expect(obs).toContainEqual({ kind: "line", from: 6, to: 6, cls: "wl-md-fenced", widget: null });
    expect(obs).toContainEqual({ kind: "line", from: 19, to: 19, cls: "wl-md-fenced", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 3, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 19, to: 22, cls: null, widget: null });
    // Fence content is real bytes: no replace ever covers it.
    expect(obs.some((o) => o.kind === "replace" && o.from >= 6 && o.to <= 18)).toBe(false);
  });

  it("reveals both fence delimiters for a caret inside the block", () => {
    const obs = decor("```js\nconst x = 1;\n```", [EditorSelection.cursor(10)]);
    expect(hidden(obs)).toEqual([]);
    expect(obs.filter((o) => o.kind === "line")).toHaveLength(3);
  });
});

describe("computeDecorations — construct-scoped reveal (integration)", () => {
  it("a caret in plain paragraph text reveals nothing anywhere in the doc", () => {
    const obs = decor("# Head\n\nplain **text**\n\n> q", [EditorSelection.cursor(10)]);
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 0, to: 1, cls: null, widget: null }, // heading hashes
      { kind: "replace", from: 14, to: 16, cls: null, widget: null }, // opening **
      { kind: "replace", from: 20, to: 22, cls: null, widget: null }, // closing **
      { kind: "replace", from: 24, to: 25, cls: null, widget: null }, // quote >
    ]);
  });
});

describe("computeDecorations — robustness", () => {
  const garbage = [
    "**unclosed *and [[mixed",
    "]]unopened **",
    "#only-hashes-no-space ###",
    "> quote> nested >>>",
    "- - - [[ | ]] **]`[",
    "```unclosed fence",
    "[[|]] [[target only",
    "!!!! §§§ ﬁ",
  ].join("\n");

  it("never throws on malformed or garbage input", () => {
    expect(() => decor(garbage)).not.toThrow();
    expect(() => decor("")).not.toThrow();
    expect(() => decor("#\n*\n`\n[\n>\n-")).not.toThrow();
    // …with a caret moving through it, too.
    expect(() => decor(garbage, [EditorSelection.cursor(5)])).not.toThrow();
    expect(() => decor("", [EditorSelection.cursor(0)])).not.toThrow();
  });

  it("rejoins doc text with every replacement byte-identical (only syntax is hidden)", () => {
    const text = [
      "# Head",
      "",
      "**bold** *em* `code` [[Note|Alias]] [[Plain]]",
      "",
      "> quoted",
      "",
      "- item",
      "",
      "---",
      "",
      "```js",
      "let x;",
      "```",
      "",
    ].join("\n");
    const doc = Text.of(text.split("\n"));
    // Position of a needle's first char + offset, so the cases below stay
    // readable and self-updating if the fixture text changes.
    const at = (needle: string, offset = 0): number => text.indexOf(needle) + offset;

    const cases: [string, readonly SelectionRange[]][] = [
      ["no selections", []],
      ["caret in the heading", [EditorSelection.cursor(at("# Head", 3))]],
      ["caret inside bold", [EditorSelection.cursor(at("**bold**", 4))]],
      ["caret inside the aliased wikilink", [EditorSelection.cursor(at("[[Note|Alias]]", 8))]],
      ["caret in the quote block", [EditorSelection.cursor(at("> quoted", 3))]],
      ["caret on the bullet", [EditorSelection.cursor(at("- item", 0))]],
      ["caret on the rule", [EditorSelection.cursor(at("---", 1))]],
      ["caret inside the fenced block", [EditorSelection.cursor(at("let x;", 2))]],
      ["partial cut across bold", [EditorSelection.range(at("**bold**", 6), at("**bold**", 9))]],
      [
        "multi-cursor across constructs",
        [EditorSelection.cursor(3), EditorSelection.range(at("- item", 2), at("---", 0))],
      ],
    ];

    for (const [label, selections] of cases) {
      const obs = observed(computeDecorations(doc, parser.parse(text).topNode, selections));
      const spans = hidden(obs).sort((a, b) => a.from - b.from || a.to - b.to);

      // Replace ranges never overlap (CM6 requirement) and stay in bounds.
      let prevTo = 0;
      for (const r of spans) {
        expect(r.from, label).toBeGreaterThanOrEqual(prevTo);
        expect(r.to, label).toBeGreaterThanOrEqual(r.from);
        prevTo = r.to;
      }

      // Joining visible text + hidden spans reproduces the original bytes.
      let rejoined = "";
      let pos = 0;
      for (const r of spans) {
        rejoined += text.slice(pos, r.from) + text.slice(r.from, r.to);
        pos = r.to;
      }
      rejoined += text.slice(pos);
      expect(rejoined, label).toBe(text);

      // Every hidden span is markdown syntax — never content.
      for (const r of spans) {
        expect(
          ["#", "**", "*", "`", "[[", "]]", "Note|", ">", "-", "---", "```"],
          label,
        ).toContain(text.slice(r.from, r.to));
      }
    }

    // With nothing selected, exactly the full syntax set is hidden.
    const all = observed(computeDecorations(doc, parser.parse(text).topNode, []))
      .filter((o) => o.kind === "replace" || o.kind === "widget")
      .sort((a, b) => a.from - b.from || a.to - b.to);
    expect(all.map((r) => text.slice(r.from, r.to))).toEqual([
      "#",
      "**",
      "**",
      "*",
      "*",
      "`",
      "`",
      "[[",
      "Note|",
      "]]",
      "[[",
      "]]",
      ">",
      "-",
      "---",
      "```",
      "```",
    ]);
  });
});
