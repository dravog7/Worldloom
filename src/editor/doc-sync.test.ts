import { describe, expect, it } from "vitest";
import { shouldReplaceDoc } from "./doc-sync";

describe("shouldReplaceDoc — external content adoption", () => {
  it("always adopts content when the note path changed", () => {
    expect(
      shouldReplaceDoc("a.md", "local a", true, "b.md", "content of b"),
    ).toBe(true);
  });

  it("adopts differing external content when there are no unsaved local edits", () => {
    expect(
      shouldReplaceDoc("a.md", "editor text", false, "a.md", "disk text"),
    ).toBe(true);
  });

  it("does not replace when external content matches the editor", () => {
    expect(
      shouldReplaceDoc("a.md", "same text", false, "a.md", "same text"),
    ).toBe(false);
  });

  it("never clobbers unsaved local edits with differing external content", () => {
    expect(
      shouldReplaceDoc("a.md", "unsaved typing", true, "a.md", "disk text"),
    ).toBe(false);
  });
});
