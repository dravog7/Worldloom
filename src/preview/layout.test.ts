import { describe, expect, it } from "vitest";
import { isLayoutMode, nextLayout } from "./layout";

describe("nextLayout — split/editor/preview cycle", () => {
  it("cycles split → editor-only → preview-only → split", () => {
    expect(nextLayout("split")).toBe("editor-only");
    expect(nextLayout("editor-only")).toBe("preview-only");
    expect(nextLayout("preview-only")).toBe("split");
  });
});

describe("isLayoutMode — settings persistence guard", () => {
  it("accepts exactly the three layout modes", () => {
    expect(isLayoutMode("split")).toBe(true);
    expect(isLayoutMode("editor-only")).toBe(true);
    expect(isLayoutMode("preview-only")).toBe(true);
  });

  it("rejects junk coming back from persisted settings", () => {
    expect(isLayoutMode("Split")).toBe(false);
    expect(isLayoutMode("")).toBe(false);
    expect(isLayoutMode("panels")).toBe(false);
    expect(isLayoutMode("split ")).toBe(false);
  });
});
