import { describe, expect, it } from "vitest";
import { parseNote } from "./index";

// Scaffold contract test (PLAN-M1 A1). B1 replaces the stub with the real
// parser; this test flips from "throws" to real behavior in that wave.
describe("parseNote (scaffold stub)", () => {
  it("throws NotImplementedError until B1 implements it", () => {
    expect(() => parseNote("notes/a.md", "# A\n")).toThrowError(
      /not implemented/i,
    );
  });
});
