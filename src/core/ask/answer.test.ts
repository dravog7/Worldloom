import { describe, expect, it } from "vitest";
import { extractCitations, renderAnswer } from "./answer";

const PATHS = ["places/Vael'Thor.md", "ports/Salt.md", "Note.md", "Other/Note.md", "it's-fine.md"];

describe("extractCitations", () => {
  it("extracts a bare known-path citation", () => {
    expect(extractCitations("The Synod ruled from places/Vael'Thor.md for a age.", PATHS)).toEqual([
      { path: "places/Vael'Thor.md" },
    ]);
  });

  it("extracts a path:line citation with the literal line number", () => {
    expect(extractCitations("See ports/Salt.md:12 for the treaty.", PATHS)).toEqual([
      { path: "ports/Salt.md", line: 12 },
    ]);
  });

  it("extracts citations from the [[wikilink]] form the prompt mandates", () => {
    expect(extractCitations("As recorded in [[ports/Salt.md:7]].", PATHS)).toEqual([
      { path: "ports/Salt.md", line: 7 },
    ]);
  });

  it("ignores unknown paths entirely", () => {
    expect(extractCitations("mystery/Unknown.md and now really.md", PATHS)).toEqual([]);
  });

  it("does not fire on partial-word lookalikes", () => {
    const text = "Notes.md, Note.mdx, and PrefixedNote.md are not citations.";
    expect(extractCitations(text, PATHS)).toEqual([]);
  });

  it("prefers the longest known path over a suffix of it", () => {
    expect(extractCitations("Mentioned Other/Note.md today.", PATHS)).toEqual([
      { path: "Other/Note.md" },
    ]);
  });

  it("keeps distinct citations in order and dedupes exact repeats", () => {
    const text = "ports/Salt.md:1 then places/Vael'Thor.md then ports/Salt.md:1 again.";
    expect(extractCitations(text, PATHS)).toEqual([
      { path: "ports/Salt.md", line: 1 },
      { path: "places/Vael'Thor.md" },
    ]);
  });

  it("does not treat a line suffix inside a longer number as a citation line", () => {
    // "ports/Salt.md:1234abc" — :1234 is followed by a word char, so the
    // path itself is part of a longer token; no citation at all.
    expect(extractCitations("see ports/Salt.md:12abc", PATHS)).toEqual([]);
  });
});

describe("renderAnswer", () => {
  it("linkifies a known path with data-path and a line anchor", () => {
    const html = renderAnswer("See ports/Salt.md:3 for details.", PATHS);
    expect(html).toContain('<a class="wl-cite" data-path="ports/Salt.md" data-line="3" href="#">ports/Salt.md:3</a>');
  });

  it("linkifies without a line when none was cited", () => {
    const html = renderAnswer("See ports/Salt.md.", PATHS);
    expect(html).toContain('data-path="ports/Salt.md"');
    expect(html).not.toContain("data-line");
  });

  it("strips the wikilink brackets around known citations", () => {
    const html = renderAnswer("As in [[ports/Salt.md]].", PATHS);
    expect(html).toContain('data-path="ports/Salt.md"');
    expect(html).not.toContain("[[");
  });

  it("leaves unknown paths as plain text", () => {
    const html = renderAnswer("See mystery/Unknown.md.", PATHS);
    expect(html).not.toContain("<a");
    expect(html).toContain("mystery/Unknown.md");
  });

  it("escapes hostile note/answer content (untrusted model output)", () => {
    const hostile =
      '<script>alert("pwn")</script> and <img src=x onerror=alert(1)> plus </a><a data-path="evil.md">fake';
    const html = renderAnswer(hostile, PATHS);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    // The attacker's fake anchor is inert text, not markup.
    expect(html).not.toContain('<a data-path="evil.md"');
  });

  it("escapes quotes in attribute values so a hostile path cannot break out", () => {
    const html = renderAnswer("Quoted: it's-fine.md", PATHS);
    expect(html).toContain('data-path="it&#39;s-fine.md"');
    expect(html).not.toContain("data-path=\"it's");
  });

  it("renders plain text with line breaks preserved as text", () => {
    const html = renderAnswer("First line.\nSecond line.", PATHS);
    expect(html).toBe("First line.\nSecond line.");
  });
});
