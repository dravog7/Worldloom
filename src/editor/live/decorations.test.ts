// @vitest-environment jsdom
/**
 * W1 — TOTAL, UNCONDITIONAL markdown syntax hiding (ADR-005 rework).
 *
 * The M1.2 construct-scoped reveal rule (reveal.ts) is intentionally
 * deleted: no caret or selection position ever reveals raw syntax. The
 * regression this wave exists to kill is pinned by parameterizing the caret
 * (doc start / inside the construct / doc end) and asserting the hidden
 * set is identical in every position. W1 also adds: links `[t](u)` (text
 * kept), ordered markers, `_em_`, strikethrough, whole fence lines, HTML
 * comments, `<u>` tags, and the YAML frontmatter 'Note properties' chip.
 *
 * The tests observe the DecorationSet structurally: CM6 RangeValue startSide/
 * endSide values distinguish line (±-2e8) / replace / mark ranges, and widgets
 * carry a public `label` for identity.
 */
import { describe, expect, it } from "vitest";
import { EditorSelection, Text, type SelectionRange } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import {
  DecorationSet,
  type Decoration,
  type EditorView,
  type WidgetType,
} from "@codemirror/view";
import { computeDecorations } from "./decorations";

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

function decorSet(
  text: string,
  selections: readonly SelectionRange[] = [],
): DecorationSet {
  const doc = Text.of(text.split("\n"));
  return computeDecorations(doc, parser.parse(text).topNode, selections);
}

function decor(
  text: string,
  selections: readonly SelectionRange[] = [],
): Observed[] {
  return observed(decorSet(text, selections));
}

/** Only the replace/widget decorations (the hidden raw-syntax spans). */
function hidden(obs: Observed[]): Observed[] {
  return obs.filter((o) => o.kind === "replace" || o.kind === "widget");
}

function widgetInstanceAt(set: DecorationSet, from: number): WidgetType | null {
  for (const iter = set.iter(); iter.value; iter.next()) {
    if (iter.from !== from) continue;
    const widget = (iter.value.spec as { widget?: WidgetType }).widget;
    if (widget) return widget;
  }
  return null;
}

/**
 * The caret spots the old reveal rule flipped on: at the doc's start, in
 * the construct's strict interior, and at the doc's end. W1 must produce
 * the exact same hidden set in all three.
 */
function caretSpots(
  text: string,
  inside: number,
): [string, SelectionRange][] {
  return [
    ["doc start", EditorSelection.cursor(0)],
    ["inside the construct", EditorSelection.cursor(inside)],
    ["doc end", EditorSelection.cursor(text.length)],
  ];
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

  it("hides the hashes of deeper levels too (h4–h6 reuse the h3 class)", () => {
    const obs = decor("#### deep\n\n###### deepest");
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-h3", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 4, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "line", from: 11, to: 11, cls: "wl-md-h3", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 11, to: 17, cls: null, widget: null });
  });

  for (const [where, range] of caretSpots("# Title", 3)) {
    it(`hides the hash prefix with the caret at the ${where} (never reveals)`, () => {
      const obs = decor("# Title", [range]);
      expect(obs).toContainEqual({ kind: "replace", from: 0, to: 1, cls: null, widget: null });
      expect(obs.some((o) => o.kind === "widget")).toBe(false);
    });
  }

  it("a selection over the heading keeps the hashes hidden", () => {
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

  it("hides the _ markers of _em_ and wraps the content in wl-md-em", () => {
    const obs = decor("say _soft_ now");
    expect(obs).toContainEqual({ kind: "replace", from: 4, to: 5, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 9, to: 10, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 5, to: 9, cls: "wl-md-em", widget: null });
  });

  it("hides the ~~ markers and wraps the content in wl-md-strike", () => {
    const obs = decor("~~gone~~ here");
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 2, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 6, to: 8, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 2, to: 6, cls: "wl-md-strike", widget: null });
  });

  it("hides the inline-code backticks and wraps the content in wl-md-code", () => {
    const obs = decor("run `npm i` now");
    expect(obs).toContainEqual({ kind: "replace", from: 4, to: 5, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 10, to: 11, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 5, to: 10, cls: "wl-md-code", widget: null });
  });

  for (const [where, range] of caretSpots("say **loud** now", 8)) {
    it(`hides ** with the caret at the ${where}`, () => {
      const obs = decor("say **loud** now", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 4, to: 6, cls: null, widget: null },
        { kind: "replace", from: 10, to: 12, cls: null, widget: null },
      ]);
      // Class styling survives regardless of the caret.
      expect(obs).toContainEqual({ kind: "mark", from: 6, to: 10, cls: "wl-md-strong", widget: null });
    });
  }

  for (const [where, range] of caretSpots("say *soft* now", 6)) {
    it(`hides * with the caret at the ${where}`, () => {
      const obs = decor("say *soft* now", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 4, to: 5, cls: null, widget: null },
        { kind: "replace", from: 9, to: 10, cls: null, widget: null },
      ]);
    });
  }

  for (const [where, range] of caretSpots("say _soft_ now", 6)) {
    it(`hides _ with the caret at the ${where}`, () => {
      const obs = decor("say _soft_ now", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 4, to: 5, cls: null, widget: null },
        { kind: "replace", from: 9, to: 10, cls: null, widget: null },
      ]);
    });
  }

  for (const [where, range] of caretSpots("run `npm i` now", 7)) {
    it(`hides inline-code backticks with the caret at the ${where}`, () => {
      const obs = decor("run `npm i` now", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 4, to: 5, cls: null, widget: null },
        { kind: "replace", from: 10, to: 11, cls: null, widget: null },
      ]);
    });
  }

  for (const [where, range] of caretSpots("~~gone~~ here", 4)) {
    it(`hides ~~ with the caret at the ${where}`, () => {
      const obs = decor("~~gone~~ here", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 0, to: 2, cls: null, widget: null },
        { kind: "replace", from: 6, to: 8, cls: null, widget: null },
      ]);
    });
  }

  it("a selection cutting a bold construct leaves no ** visible anywhere", () => {
    const text = "say **loud** now";
    // Cuts the closing `**` (the old reveal trigger: exactly one endpoint
    // in the construct's strict interior).
    const obs = decor(text, [EditorSelection.range(2, 10)]);
    const spans = hidden(obs);
    // Every ** occurrence in the doc is fully covered by a replaced range
    // — i.e. shows no `**` to the reader, in any replaced range or outside.
    for (let i = text.indexOf("**"); i !== -1; i = text.indexOf("**", i + 1)) {
      expect(spans.some((r) => r.from <= i && r.to >= i + 2)).toBe(true);
    }
    expect(spans).toEqual([
      { kind: "replace", from: 4, to: 6, cls: null, widget: null },
      { kind: "replace", from: 10, to: 12, cls: null, widget: null },
    ]);
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

  it("a caret between two constructs on one line hides both", () => {
    const obs = decor("**bold** text *em*", [EditorSelection.cursor(11)]);
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 0, to: 2, cls: null, widget: null },
      { kind: "replace", from: 6, to: 8, cls: null, widget: null },
      { kind: "replace", from: 14, to: 15, cls: null, widget: null },
      { kind: "replace", from: 17, to: 18, cls: null, widget: null },
    ]);
  });
});

describe("computeDecorations — links", () => {
  it("hides the brackets, parens and URL of [text](url), keeping the text", () => {
    const obs = decor("[text](https://example.com)");
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 0, to: 1, cls: null, widget: null }, // [
      { kind: "replace", from: 5, to: 27, cls: null, widget: null }, // ](url)
    ]);
    // The visible text is never covered by a replace.
    expect(obs.some((o) => o.kind === "replace" && o.from < 5 && o.to > 1)).toBe(false);
  });

  for (const [where, range] of caretSpots("[text](https://example.com)", 3)) {
    it(`keeps the link hidden with the caret at the ${where}`, () => {
      const obs = decor("[text](https://example.com)", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 0, to: 1, cls: null, widget: null },
        { kind: "replace", from: 5, to: 27, cls: null, widget: null },
      ]);
    });
  }

  it("still hides the ** of a bolded link text", () => {
    const obs = decor("[**bold link**](url)");
    expect(hidden(obs)).toContainEqual({ kind: "replace", from: 1, to: 3, cls: null, widget: null });
    expect(hidden(obs)).toContainEqual({ kind: "replace", from: 12, to: 14, cls: null, widget: null });
    expect(hidden(obs)).toContainEqual({ kind: "replace", from: 14, to: 20, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 3, to: 12, cls: "wl-md-strong", widget: null });
  });

  it("leaves reference-style links raw (robustness: no URL part)", () => {
    const obs = decor("[ref][1] and [collapsed][]");
    expect(hidden(obs)).toEqual([]);
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

  for (const [where, range] of caretSpots("[[Note|Alias]]", 8)) {
    it(`keeps the wikilink chip-hidden with the caret at the ${where}`, () => {
      const obs = decor("[[Note|Alias]]", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 0, to: 2, cls: null, widget: null },
        { kind: "replace", from: 2, to: 7, cls: null, widget: null },
        { kind: "replace", from: 12, to: 14, cls: null, widget: null },
      ]);
      expect(obs).toContainEqual({ kind: "mark", from: 0, to: 14, cls: "wl-md-wikilink", widget: null });
    });
  }

  it("a caret inside a wikilink keeps a bold span on the same line hidden", () => {
    const obs = decor("[[Note]] and **bold**", [EditorSelection.cursor(4)]);
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 0, to: 2, cls: null, widget: null },
      { kind: "replace", from: 6, to: 8, cls: null, widget: null },
      { kind: "replace", from: 13, to: 15, cls: null, widget: null },
      { kind: "replace", from: 19, to: 21, cls: null, widget: null },
    ]);
    expect(obs).toContainEqual({ kind: "mark", from: 15, to: 19, cls: "wl-md-strong", widget: null });
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

  for (const [where, range] of caretSpots("> quoted\n> more", 3)) {
    it(`keeps every > marker hidden with the caret at the ${where}`, () => {
      const obs = decor("> quoted\n> more", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 0, to: 1, cls: null, widget: null },
        { kind: "replace", from: 9, to: 10, cls: null, widget: null },
      ]);
      expect(obs.filter((o) => o.kind === "line")).toHaveLength(2);
    });
  }

  it.each(["- item", "* item", "+ item"])(
    "collapses the bullet marker of %s to a dim • widget",
    (text) => {
      const obs = decor(text);
      expect(obs).toContainEqual({ kind: "widget", from: 0, to: 1, cls: null, widget: "•" });
    },
  );

  it.each([
    ["1. first", 2, "1."],
    ["11) eleven", 3, "11)"],
  ])("collapses the ordered marker of %s to a dim widget", (text, len, label) => {
    const obs = decor(text);
    expect(obs).toContainEqual({ kind: "widget", from: 0, to: len, cls: null, widget: label });
  });

  for (const [where, range] of [
    ["the item's start", EditorSelection.cursor(0)],
    ["the item's interior", EditorSelection.cursor(4)],
    ["the item's end", EditorSelection.cursor(6)],
  ] as const) {
    it(`keeps the bullet collapsed with the caret at ${where}`, () => {
      const obs = decor("- item", [range]);
      expect(obs).toContainEqual({ kind: "widget", from: 0, to: 1, cls: null, widget: "•" });
    });
  }

  it("keeps the ordered marker collapsed with the caret inside the item", () => {
    const obs = decor("1. first", [EditorSelection.cursor(5)]);
    expect(obs).toContainEqual({ kind: "widget", from: 0, to: 2, cls: null, widget: "1." });
  });

  it("keeps the bullet collapsed in every item when the caret is in one of them", () => {
    const obs = decor("- item\n- other", [EditorSelection.cursor(8)]);
    expect(hidden(obs)).toEqual([
      { kind: "widget", from: 0, to: 1, cls: null, widget: "•" },
      { kind: "widget", from: 7, to: 8, cls: null, widget: "•" },
    ]);
  });

  it("replaces a horizontal-rule line with a styled rule element", () => {
    const obs = decor("text\n\n---\n\nmore");
    expect(obs).toContainEqual({ kind: "widget", from: 6, to: 9, cls: null, widget: "—" });
  });

  it("keeps the raw rule replaced for a caret on it (never reveals)", () => {
    const obs = decor("text\n\n---\n\nmore", [EditorSelection.cursor(7)]);
    expect(obs).toContainEqual({ kind: "widget", from: 6, to: 9, cls: null, widget: "—" });
  });

  it("styles every fenced-code line and replaces the whole fence lines", () => {
    const obs = decor("```js\nconst x = 1;\n```");
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-fenced", widget: null });
    expect(obs).toContainEqual({ kind: "line", from: 6, to: 6, cls: "wl-md-fenced", widget: null });
    expect(obs).toContainEqual({ kind: "line", from: 19, to: 19, cls: "wl-md-fenced", widget: null });
    // The whole fence lines go — info string included.
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 5, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 19, to: 22, cls: null, widget: null });
    // Fence content is real bytes: no replace ever covers it.
    expect(obs.some((o) => o.kind === "replace" && o.from >= 6 && o.to <= 18)).toBe(false);
  });

  for (const [where, range] of [
    ["the opening fence", EditorSelection.cursor(1)],
    ["the code content", EditorSelection.cursor(10)],
    ["the closing fence", EditorSelection.cursor(20)],
  ] as const) {
    it(`keeps both fence lines replaced with the caret at ${where}`, () => {
      const obs = decor("```js\nconst x = 1;\n```", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 0, to: 5, cls: null, widget: null },
        { kind: "replace", from: 19, to: 22, cls: null, widget: null },
      ]);
    });
  }
});

describe("computeDecorations — HTML comments and <u> tags", () => {
  it("makes a provenance comment invisible (whole block replaced)", () => {
    const obs = decor("<!-- provenance: audit -->\n\nbody");
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 0, to: 26, cls: null, widget: null },
    ]);
    expect(obs.some((o) => o.kind === "replace" && o.from >= 28)).toBe(false);
  });

  for (const [where, range] of caretSpots("<!-- provenance: audit -->\n\nbody", 9)) {
    it(`keeps the provenance comment invisible with the caret at the ${where}`, () => {
      const obs = decor("<!-- provenance: audit -->\n\nbody", [range]);
      expect(hidden(obs)).toEqual([
        { kind: "replace", from: 0, to: 26, cls: null, widget: null },
      ]);
    });
  }

  it("hides an inline comment without eating the text around it", () => {
    const obs = decor("alpha <!-- mid --> beta");
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 6, to: 18, cls: null, widget: null },
    ]);
  });

  it("hides a multiline inline comment, keeping the trailing text", () => {
    const obs = decor("line one <!-- c\nmultiline --> line");
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 9, to: 29, cls: null, widget: null },
    ]);
  });

  it("an unclosed <!-- is not a comment — nothing is hidden", () => {
    const obs = decor("text <!-- unclosed");
    expect(hidden(obs)).toEqual([]);
  });

  it("hides <u> and </u> and underlines the content between them", () => {
    const obs = decor("a <u>under</u> z");
    expect(obs).toContainEqual({ kind: "replace", from: 2, to: 5, cls: null, widget: null }); // <u>
    expect(obs).toContainEqual({ kind: "replace", from: 10, to: 14, cls: null, widget: null }); // </u>
    expect(obs).toContainEqual({ kind: "mark", from: 5, to: 10, cls: "wl-md-underline", widget: null });
  });

  it("does NOT hide other inline-HTML tags like <em>", () => {
    const obs = decor("a <em>em</em> z");
    expect(hidden(obs)).toEqual([]);
  });
});

describe("computeDecorations — YAML frontmatter chip", () => {
  const FM = "---\ntitle: Note\ntags: [a]\n---\n\nbody **bold**";

  it("replaces the whole frontmatter block with exactly one chip widget", () => {
    const obs = decor(FM);
    expect(obs.filter((o) => o.from < 29)).toEqual([
      { kind: "widget", from: 0, to: 29, cls: null, widget: "Note properties" },
    ]);
  });

  it("renders the document after the frontmatter exactly as before", () => {
    const obs = decor(FM);
    // Body bold: markers hidden, content styled — unchanged by the chip.
    expect(obs).toContainEqual({ kind: "replace", from: 36, to: 38, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 42, to: 44, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "mark", from: 38, to: 42, cls: "wl-md-strong", widget: null });
  });

  for (const [where, range] of caretSpots(FM, 10)) {
    it(`keeps the single chip with the caret at the ${where}`, () => {
      const obs = decor(FM, [range]);
      expect(hidden(obs)).toEqual([
        { kind: "widget", from: 0, to: 29, cls: null, widget: "Note properties" },
        { kind: "replace", from: 36, to: 38, cls: null, widget: null },
        { kind: "replace", from: 42, to: 44, cls: null, widget: null },
      ]);
    });
  }

  it("the chip is a non-editable 'Note properties' widget dispatching the frozen event", () => {
    const set = decorSet(FM);
    const widget = widgetInstanceAt(set, 0);
    expect(widget).not.toBeNull();
    const el = widget!.toDOM(null as unknown as EditorView);
    expect(el.getAttribute("aria-label")).toBe("Note properties");
    expect(el.getAttribute("contenteditable")).toBe("false");
    expect(el.className).toBe("wl-frontmatter-chip");
    expect(el.textContent).toBe("Note properties");

    // The frozen contract: a bubbling CustomEvent any host listener catches.
    const host = document.createElement("div");
    let received: Event | null = null;
    host.addEventListener("wl-open-properties", (e) => {
      received = e;
    });
    host.appendChild(el);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(received).not.toBeNull();
    expect(received!.type).toBe("wl-open-properties");
    expect(received!.bubbles).toBe(true);
  });

  it("a doc that merely starts with --- but never closes is a rule, not frontmatter", () => {
    const obs = decor("---\ntitle: x");
    expect(obs).toContainEqual({ kind: "widget", from: 0, to: 3, cls: null, widget: "—" });
    expect(obs.some((o) => o.widget === "Note properties")).toBe(false);
  });

  it("a mid-document --- stays a rule (frontmatter must lead the doc)", () => {
    const obs = decor("intro\n\n---\n\ntail");
    expect(obs).toContainEqual({ kind: "widget", from: 7, to: 10, cls: null, widget: "—" });
    expect(obs.some((o) => o.widget === "Note properties")).toBe(false);
  });
});

describe("computeDecorations — hiding is unconditional (integration)", () => {
  const KITCHEN = [
    "# Head",
    "",
    "**bold** *em* _sm_ `code` ~~gone~~ [text](url) [[Note|Alias]]",
    "",
    "> quoted",
    "",
    "- item",
    "+ plus",
    "",
    "3. ordered",
    "",
    "---",
    "",
    "```js",
    "let x;",
    "```",
    "",
    "<!-- provenance -->",
    "",
    "a <u>under</u> z",
  ].join("\n");
  const at = (needle: string, offset = 0): number =>
    KITCHEN.indexOf(needle) + offset;

  const battery: [string, readonly SelectionRange[]][] = [
    ["no selection", []],
    ["caret at doc start", [EditorSelection.cursor(0)]],
    ["caret in the heading", [EditorSelection.cursor(at("# Head", 3))]],
    ["caret inside bold", [EditorSelection.cursor(at("**bold**", 4))]],
    ["caret inside _em_", [EditorSelection.cursor(at("_sm_", 2))]],
    ["caret inside inline code", [EditorSelection.cursor(at("`code`", 3))]],
    ["caret inside strikethrough", [EditorSelection.cursor(at("~~gone~~", 4))]],
    ["caret inside link text", [EditorSelection.cursor(at("[text](url)", 3))]],
    ["caret inside the wikilink", [EditorSelection.cursor(at("[[Note|Alias]]", 8))]],
    ["caret in the quote", [EditorSelection.cursor(at("> quoted", 3))]],
    ["caret on the bullet", [EditorSelection.cursor(at("- item", 0))]],
    ["caret in the ordered item", [EditorSelection.cursor(at("3. ordered", 5))]],
    ["caret on the rule", [EditorSelection.cursor(at("---", 1))]],
    ["caret inside the fence content", [EditorSelection.cursor(at("let x;", 2))]],
    ["caret inside the provenance comment", [EditorSelection.cursor(at("<!-- provenance -->", 9))]],
    ["caret inside <u> content", [EditorSelection.cursor(at("<u>under</u>", 6))]],
    ["caret at doc end", [EditorSelection.cursor(KITCHEN.length)]],
    ["selection spanning bold", [EditorSelection.range(at("**bold**", 0), at("**bold**", 9))]],
    ["selection cutting bold", [EditorSelection.range(at("**bold**", 3), at("**bold**", 6))]],
    [
      "multi-cursor across constructs",
      [EditorSelection.cursor(2), EditorSelection.range(at("- item", 1), at("3. ordered", 2))],
    ],
  ];

  it("produces the identical hidden set for every caret/selection position", () => {
    const baseline = hidden(decor(KITCHEN)).sort((a, b) => a.from - b.from);
    expect(baseline.length).toBeGreaterThan(10); // the doc really is full of syntax
    for (const [label, selections] of battery) {
      const obs = hidden(decor(KITCHEN, selections)).sort((a, b) => a.from - b.from);
      expect(obs, label).toEqual(baseline);
    }
  });

  it("rejoins doc text byte-identically and hides only markdown syntax", () => {
    const text = KITCHEN;
    const SYNTAX_SLICES = new Set([
      "#", "**", "*", "_", "`", "~~", "[", "](url)", "[[", "]]", "Note|",
      ">", "-", "+", "---", "```js", "```", "<!-- provenance -->", "<u>", "</u>",
    ]);
    const isSyntax = (s: string): boolean =>
      SYNTAX_SLICES.has(s) || /^\d+[.)]$/.test(s);

    for (const [label, selections] of battery) {
      const spans = hidden(decor(text, selections)).sort((a, b) => a.from - b.from);

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
        expect(isSyntax(text.slice(r.from, r.to)), `${label}: ${text.slice(r.from, r.to)}`).toBe(true);
      }
    }
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
    "<!-- never closed",
    "[]() [](x) [a][b]",
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

  it("an unclosed fence hides only its own line", () => {
    const obs = decor("```unclosed fence");
    expect(hidden(obs)).toEqual([
      { kind: "replace", from: 0, to: 17, cls: null, widget: null },
    ]);
  });
});
