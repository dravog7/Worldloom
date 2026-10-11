import { describe, expect, it } from "vitest";
import type { SearchHit } from "../core/types";
import { initialSearchState, searchReducer, select, type SearchState } from "./search";

const hits: SearchHit[] = [
  { path: "a.md", title: "Alpha", score: 3 },
  { path: "b.md", title: "Beta", score: 2 },
  { path: "c.md", title: "Gamma", score: 1 },
];

const withHits: SearchState = { open: true, query: "g", hits, cursor: 0 };

describe("initialSearchState", () => {
  it("starts closed with an empty query, no hits and no cursor", () => {
    expect(initialSearchState).toEqual({ open: false, query: "", hits: [], cursor: -1 });
  });
});

describe("searchReducer", () => {
  it("open starts a fresh palette: open, empty query, no hits, cursor reset", () => {
    const stale: SearchState = { open: false, query: "old", hits, cursor: 2 };
    const next = searchReducer(stale, { type: "open" });
    expect(next).toEqual({ open: true, query: "", hits: [], cursor: -1 });
  });

  it("close clears query, hits and cursor", () => {
    const next = searchReducer(withHits, { type: "close" });
    expect(next).toEqual({ open: false, query: "", hits: [], cursor: -1 });
  });

  it("type updates the query and clamps the cursor into range", () => {
    const next = searchReducer({ ...withHits, cursor: 2 }, { type: "type", query: "ga" });
    expect(next.query).toBe("ga");
    expect(next.cursor).toBe(2);
  });

  it("type with an empty query clears the hits", () => {
    const next = searchReducer(withHits, { type: "type", query: "" });
    expect(next.query).toBe("");
    expect(next.hits).toEqual([]);
    expect(next.cursor).toBe(-1);
  });

  it("setHits replaces the hits and moves the cursor to the first hit", () => {
    const other: SearchHit[] = [{ path: "z.md", title: "Zeta", score: 9 }];
    const next = searchReducer({ ...withHits, cursor: 2 }, { type: "setHits", hits: other });
    expect(next.hits).toEqual(other);
    expect(next.cursor).toBe(0);
  });

  it("setHits with an empty list leaves the cursor at -1", () => {
    const next = searchReducer(withHits, { type: "setHits", hits: [] });
    expect(next.hits).toEqual([]);
    expect(next.cursor).toBe(-1);
  });

  it("move wraps forward from the last hit back to the first", () => {
    const next = searchReducer({ ...withHits, cursor: 2 }, { type: "move", delta: 1 });
    expect(next.cursor).toBe(0);
  });

  it("move wraps backward from the first hit to the last", () => {
    const next = searchReducer({ ...withHits, cursor: 0 }, { type: "move", delta: -1 });
    expect(next.cursor).toBe(2);
  });

  it("move steps by the delta magnitude and wraps across multiple ends", () => {
    const next = searchReducer({ ...withHits, cursor: 0 }, { type: "move", delta: 4 });
    expect(next.cursor).toBe(1);
  });

  it("move with no hits keeps the cursor at -1", () => {
    const next = searchReducer({ open: true, query: "x", hits: [], cursor: -1 }, { type: "move", delta: 1 });
    expect(next.cursor).toBe(-1);
  });

  it("move onto an empty result set after setHits never points at a stale hit", () => {
    const cleared = searchReducer(withHits, { type: "setHits", hits: [] });
    const moved = searchReducer(cleared, { type: "move", delta: 1 });
    expect(moved.cursor).toBe(-1);
    expect(select(moved)).toBeNull();
  });

  it("does not mutate the previous state", () => {
    const before = { ...withHits };
    searchReducer(withHits, { type: "move", delta: 1 });
    searchReducer(withHits, { type: "close" });
    expect(withHits).toEqual(before);
  });
});

describe("select", () => {
  it("returns the hit under the cursor", () => {
    expect(select({ ...withHits, cursor: 1 })).toBe(hits[1]);
  });

  it("returns null when there are no hits", () => {
    expect(select({ open: true, query: "q", hits: [], cursor: -1 })).toBeNull();
  });

  it("returns null when the cursor is out of range", () => {
    expect(select({ ...withHits, cursor: 7 })).toBeNull();
  });
});
