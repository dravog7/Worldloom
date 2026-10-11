import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { DecorationSet, type Decoration } from "@codemirror/view";
import { computeDecorations } from "./decorations";

/**
 * ADR-005 live-preview decorations: markdown stays the storage bytes; syntax
 * is hidden via replace decorations and styled via marks. Revealed lines
 * (cursor neighbourhood) keep their raw syntax visible.
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

function decor(text: string, revealed: readonly number[] = []): Observed[] {
  const doc = Text.of(text.split("\n"));
  return observed(computeDecorations(doc, parser.parse(text).topNode, new Set(revealed)));
}

describe("computeDecorations — headings", () => {
  it("hides the ATX hash prefix and marks the line as h1", () => {
    const obs = decor("# Title\n\nBody");
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-h1", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 1, cls: null, widget: null });
    // Only the hash is hidden — the title text stays real bytes.
    expect(obs.filter((o) => o.kind === "replace" || o.kind === "widget")).toHaveLength(1);
  });

  it("maps h2 and h3 to wl-md-h2 / wl-md-h3 with their hashes collapsed", () => {
    const obs = decor("## Two\n\n### Three");
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-h2", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 0, to: 2, cls: null, widget: null });
    expect(obs).toContainEqual({ kind: "line", from: 8, to: 8, cls: "wl-md-h3", widget: null });
    expect(obs).toContainEqual({ kind: "replace", from: 8, to: 11, cls: null, widget: null });
  });

  it("renders a revealed heading's hashes as a dim raw-syntax widget", () => {
    const obs = decor("# Title", [1]);
    expect(obs).toContainEqual({ kind: "widget", from: 0, to: 1, cls: null, widget: "#" });
    expect(obs).toContainEqual({ kind: "line", from: 0, to: 0, cls: "wl-md-h1", widget: null });
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

  it("reveals raw inline markers on the cursor line (class styling stays)", () => {
    const obs = decor("say **loud** now", [1]);
    expect(obs.some((o) => o.kind === "replace")).toBe(false);
    expect(obs).toContainEqual({ kind: "mark", from: 6, to: 10, cls: "wl-md-strong", widget: null });
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

  it("reveals the wikilink brackets on the cursor line, keeping the chip class", () => {
    const obs = decor("[[Note]]", [1]);
    expect(obs.filter((o) => o.kind === "mark")).toEqual([
      { kind: "mark", from: 0, to: 8, cls: "wl-md-wikilink", widget: null },
    ]);
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

  it("collapses a bullet marker to a dim • widget", () => {
    const obs = decor("- item");
    expect(obs).toContainEqual({ kind: "widget", from: 0, to: 1, cls: null, widget: "•" });
    expect(obs.filter((o) => o.kind === "line")).toEqual([]);
  });

  it("reveals the raw bullet marker on the cursor line", () => {
    expect(decor("- item", [1])).toEqual([]);
  });

  it("replaces a horizontal-rule line with a styled rule element", () => {
    const obs = decor("text\n\n---\n\nmore");
    expect(obs).toContainEqual({ kind: "widget", from: 6, to: 9, cls: null, widget: "—" });
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
    const obs = observed(computeDecorations(doc, parser.parse(text).topNode, new Set()));
    const hidden = obs
      .filter((o) => o.kind === "replace" || o.kind === "widget")
      .sort((a, b) => a.from - b.from || a.to - b.to);

    // Replace ranges never overlap (CM6 requirement) and stay in bounds.
    let prevTo = 0;
    for (const r of hidden) {
      expect(r.from).toBeGreaterThanOrEqual(prevTo);
      expect(r.to).toBeGreaterThanOrEqual(r.from);
      prevTo = r.to;
    }

    // Joining visible text + hidden spans reproduces the original bytes.
    let rejoined = "";
    let pos = 0;
    for (const r of hidden) {
      rejoined += text.slice(pos, r.from) + text.slice(r.from, r.to);
      pos = r.to;
    }
    rejoined += text.slice(pos);
    expect(rejoined).toBe(text);

    // And the hidden spans are exactly the markdown syntax — never content.
    expect(hidden.map((r) => text.slice(r.from, r.to))).toEqual([
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
