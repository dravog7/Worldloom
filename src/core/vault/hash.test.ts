import { describe, expect, it } from "vitest";
import { contentHash } from "./index";

describe("contentHash", () => {
  it("is deterministic and fixed-width hex", () => {
    const a = contentHash("# Alpha\n\nSome body text");
    expect(a).toBe(contentHash("# Alpha\n\nSome body text"));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("changes when content changes (single-character edits)", () => {
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
    expect(contentHash("")).not.toBe(contentHash(" "));
  });
});
