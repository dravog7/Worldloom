import { describe, expect, it } from "vitest";
import { generateStubNote, slugifyFileName } from "./index";

describe("generateStubNote", () => {
  it("produces minimal frontmatter v1 (type unset, aliases: [title]) with an H1 body", () => {
    expect(generateStubNote("The Weeping Gate")).toBe(
      "---\naliases: [The Weeping Gate]\n---\n\n# The Weeping Gate\n",
    );
  });

  it("keeps type unset (no type: key) and the body a single H1", () => {
    const note = generateStubNote("Vault of Whispers");
    expect(note).not.toMatch(/^type:/m);
    expect(note.split("---\n\n")[1]).toBe("# Vault of Whispers\n");
  });

  it("quotes titles that would break YAML (colons, brackets)", () => {
    expect(generateStubNote("Q: What now?")).toContain('aliases: ["Q: What now?"]');
    expect(generateStubNote("A [bracketed] title")).toContain('aliases: ["A [bracketed] title"]');
  });

  it("keeps plain titles unquoted, including apostrophes and unicode", () => {
    expect(generateStubNote("Mira's Locket")).toContain("aliases: [Mira's Locket]");
    expect(generateStubNote("Vael'Thörn")).toContain("aliases: [Vael'Thörn]");
  });

  it("collapses newlines in titles so the stub stays one note", () => {
    const note = generateStubNote("Two\nLines");
    expect(note).not.toContain("\n\n\n");
    expect(note).toContain("# Two Lines");
  });
});

describe("slugifyFileName", () => {
  it("keeps the title readable — apostrophes, spaces and unicode survive", () => {
    expect(slugifyFileName("Siege of Vael'Thor")).toBe("Siege of Vael'Thor");
    expect(slugifyFileName("The Loom of Fates")).toBe("The Loom of Fates");
  });

  it("removes filesystem- and wikilink-unsafe characters", () => {
    expect(slugifyFileName('A/B: C? "D" <E> | F')).toBe("AB C D E F");
  });

  it("collapses whitespace and trims", () => {
    expect(slugifyFileName("  The   Span  ")).toBe("The Span");
  });

  it("falls back to Untitled for empty/symbol-only titles", () => {
    expect(slugifyFileName("")).toBe("Untitled");
    expect(slugifyFileName("???")).toBe("Untitled");
  });
});
