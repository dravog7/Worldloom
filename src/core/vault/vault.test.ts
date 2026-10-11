import { describe, expect, it } from "vitest";
import { generateStubNote } from "./index";

// Scaffold contract test (PLAN-M1 A1). B3 implements stub-note generation.
describe("generateStubNote (scaffold stub)", () => {
  it("throws NotImplementedError until B3 implements it", () => {
    expect(() => generateStubNote("New Character")).toThrowError(
      /not implemented/i,
    );
  });
});
