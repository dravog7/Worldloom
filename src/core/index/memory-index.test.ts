import { describe, expect, it } from "vitest";
import type { Note } from "../types";
import { MemoryIndex } from "./memory-index";

const note: Note = {
  path: "a.md",
  title: "A",
  aliases: [],
  tags: [],
  relations: [],
  body: "Body of A",
  links: [],
  mtime: 0,
};

// Scaffold contract test (PLAN-M1 A1). B2 replaces the stub with the real
// MemoryIndex per ADR-003.
describe("MemoryIndex (scaffold stub)", () => {
  it("throws NotImplementedError until B2 implements it", () => {
    const index = new MemoryIndex();
    expect(() => index.upsert(note)).toThrowError(/not implemented/i);
  });
});
