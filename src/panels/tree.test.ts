import { describe, expect, it } from "vitest";
import { flattenTree, parentPathOf, toggleExpanded, type TreeNode } from "./tree";

/** places/ (dir) ├── Vael'Thor.md └── gates/ (dir) └── The Weeping Gate.md ports/ (dir) └── Salt.md */
const sampleTree: TreeNode[] = [
  {
    name: "places",
    path: "places",
    isDirectory: true,
    children: [
      { name: "Vael'Thor.md", path: "places/Vael'Thor.md", isDirectory: false },
      {
        name: "gates",
        path: "places/gates",
        isDirectory: true,
        children: [
          { name: "The Weeping Gate.md", path: "places/gates/The Weeping Gate.md", isDirectory: false },
        ],
      },
    ],
  },
  {
    name: "ports",
    path: "ports",
    isDirectory: true,
    children: [{ name: "Salt.md", path: "ports/Salt.md", isDirectory: false }],
  },
];

const expandedDeep = new Set(["places", "places/gates", "ports"]);

describe("flattenTree", () => {
  it("emits nested rows with depth reflecting tree position", () => {
    const rows = flattenTree(sampleTree, expandedDeep);
    const depths = new Map(rows.map((r) => [r.path, r.depth]));
    expect(depths.get("places")).toBe(0);
    expect(depths.get("places/Vael'Thor.md")).toBe(1);
    expect(depths.get("places/gates")).toBe(1);
    expect(depths.get("places/gates/The Weeping Gate.md")).toBe(2);
    expect(depths.get("ports/Salt.md")).toBe(1);
  });

  it("keeps document order: depth-first, directory before its children", () => {
    const rows = flattenTree(sampleTree, expandedDeep);
    expect(rows.map((r) => r.path)).toEqual([
      "places",
      "places/Vael'Thor.md",
      "places/gates",
      "places/gates/The Weeping Gate.md",
      "ports",
      "ports/Salt.md",
    ]);
  });

  it("hides the children of a collapsed directory but keeps the directory row", () => {
    const rows = flattenTree(sampleTree, new Set(["ports"]));
    expect(rows.map((r) => r.path)).toEqual(["places", "ports", "ports/Salt.md"]);
  });

  it("marks rows with expanded state for directories", () => {
    const rows = flattenTree(sampleTree, new Set(["places"]));
    const byPath = new Map(rows.map((r) => [r.path, r]));
    expect(byPath.get("places")?.expanded).toBe(true);
    expect(byPath.get("ports")?.expanded).toBe(false);
    expect(byPath.get("places/Vael'Thor.md")?.expanded).toBe(false);
  });

  it("with an empty expanded set only root-level rows are visible", () => {
    const rows = flattenTree(sampleTree, new Set());
    expect(rows.map((r) => r.path)).toEqual(["places", "ports"]);
  });

  it("filter keeps ancestors of a match visible even when collapsed", () => {
    const rows = flattenTree(sampleTree, new Set(), "weeping");
    expect(rows.map((r) => r.path)).toEqual([
      "places",
      "places/gates",
      "places/gates/The Weeping Gate.md",
    ]);
  });

  it("filter is a case-insensitive substring match on names", () => {
    const rows = flattenTree(sampleTree, expandedDeep, "VAEL");
    expect(rows.map((r) => r.path)).toEqual(["places", "places/Vael'Thor.md"]);
  });

  it("filter drops branches with no matching descendant", () => {
    const rows = flattenTree(sampleTree, expandedDeep, "salt");
    expect(rows.map((r) => r.path)).toEqual(["ports", "ports/Salt.md"]);
  });

  it("filter that matches nothing yields no rows", () => {
    expect(flattenTree(sampleTree, expandedDeep, "zzz")).toEqual([]);
  });

  it("empty filter falls back to the expanded set (collapsed hides children)", () => {
    const collapsed = flattenTree(sampleTree, new Set(["places"]), "");
    expect(collapsed.map((r) => r.path)).toEqual(["places", "places/Vael'Thor.md", "places/gates", "ports"]);
  });
});

describe("toggleExpanded", () => {
  it("adds a collapsed path and removes an expanded one, without mutating the input", () => {
    const base = new Set(["places"]);
    const opened = toggleExpanded(base, "ports");
    expect(opened.has("ports")).toBe(true);
    expect(opened.has("places")).toBe(true);

    const closed = toggleExpanded(base, "places");
    expect(closed.has("places")).toBe(false);
    // Original set untouched (pure reducer).
    expect(base.has("places")).toBe(true);
  });
});

describe("parentPathOf", () => {
  it("returns the containing directory path", () => {
    expect(parentPathOf("places/gates/Gate.md")).toBe("places/gates");
  });

  it("returns an empty string for a root-level path", () => {
    expect(parentPathOf("Salt.md")).toBe("");
  });
});
