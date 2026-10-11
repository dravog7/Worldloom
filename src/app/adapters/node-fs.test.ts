import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeFsAdapter } from "./node-fs";

let dir: string;
const adapter = new NodeFsAdapter();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "worldloom-nodefs-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("NodeFsAdapter", () => {
  it("writeText fulfils the atomic contract: destination updated, no temp files left behind", async () => {
    const target = join(dir, "note.md");
    await adapter.writeText(target, "# v1");
    await adapter.writeText(target, "# v2 — overwritten atomically");

    expect(await readFile(target, "utf8")).toBe("# v2 — overwritten atomically");
    const leftovers = (await readdir(dir)).filter((f) => f.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("round-trips directory listings as FsPort DirEntries", async () => {
    await adapter.mkdir(join(dir, "places"));
    await adapter.writeText(join(dir, "places", "span.md"), "# Span");

    const entries = await adapter.readDir(join(dir, "places"));
    expect(entries).toEqual([{ name: "span.md", isDirectory: false }]);
  });

  it("exists() reports files and directories accurately", async () => {
    expect(await adapter.exists(join(dir, "places", "span.md"))).toBe(true);
    expect(await adapter.exists(join(dir, "places"))).toBe(true);
    expect(await adapter.exists(join(dir, "missing.md"))).toBe(false);
  });
});
