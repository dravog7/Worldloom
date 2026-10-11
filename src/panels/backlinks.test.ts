import { describe, expect, it } from "vitest";
import type { LinkRef } from "../core/types";
import { groupBacklinks } from "./backlinks";

const ref = (source: string, target: string, line: number): LinkRef => ({ source, target, line });

describe("groupBacklinks", () => {
  it("groups links by their source note", () => {
    const groups = groupBacklinks([
      ref("a.md", "Vael'Thor", 2),
      ref("b.md", "Vael'Thor", 9),
      ref("a.md", "Vael'Thor", 14),
    ]);
    expect(groups.map((g) => g.path)).toEqual(["a.md", "b.md"]);
    expect(groups[0].links).toHaveLength(2);
    expect(groups[1].links).toHaveLength(1);
  });

  it("sorts links within a group by line number ascending", () => {
    const groups = groupBacklinks([
      ref("a.md", "Gate", 40),
      ref("a.md", "Gate", 3),
      ref("a.md", "Gate", 17),
    ]);
    expect(groups[0].links.map((l) => l.line)).toEqual([3, 17, 40]);
  });

  it("orders groups deterministically by source path", () => {
    const groups = groupBacklinks([
      ref("ports/Salt.md", "Vael'Thor", 1),
      ref("places/Vael'Thor.md", "Vael'Thor", 5),
      ref("aaa.md", "Vael'Thor", 0),
    ]);
    expect(groups.map((g) => g.path)).toEqual(["aaa.md", "places/Vael'Thor.md", "ports/Salt.md"]);
  });

  it("keeps link identity (target/display) intact inside groups", () => {
    const link: LinkRef = { source: "a.md", target: "The Weeping Gate", line: 8, display: "the gate" };
    const groups = groupBacklinks([link]);
    expect(groups[0].links[0]).toEqual(link);
  });

  it("returns an empty array for no links", () => {
    expect(groupBacklinks([])).toEqual([]);
  });
});
