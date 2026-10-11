import { describe, expect, it, vi } from "vitest";
import {
  ManualTimer,
  VAULT_DEBOUNCE_MS,
  VaultNotOpenError,
  VaultService,
} from "./index";
import { FakeFs, FakeIndex, drainMicrotasks, fakeParseNote, makeNote } from "./test-fakes";

function setup(files: Record<string, string> = {}, dirs: string[] = []) {
  const fs = new FakeFs(files, dirs);
  const index = new FakeIndex();
  const parseNote = vi.fn(fakeParseNote);
  const timer = new ManualTimer();
  const service = new VaultService({ fs, parseNote, index, timer });
  return { fs, index, parseNote, timer, service };
}

describe("VaultService.scanVault", () => {
  it("walks recursively, returns sorted vault-relative .md paths, and skips .git/node_modules/dot-dirs and non-md files", async () => {
    const { service } = setup({
      "vault/notes/a.md": "# A",
      "vault/notes/deep/nest/b.md": "# B",
      "vault/c.md": "# C",
      "vault/notes/readme.txt": "not markdown",
      "vault/node_modules/pkg/evil.md": "# should be skipped",
      "vault/.git/hooks/pre-commit.md": "# should be skipped",
      "vault/.hidden/secret.md": "# should be skipped",
      "vault/.trash.md": "dot-dir rule only; dot-files are not dirs",
    });

    const paths = await service.scanVault("vault");

    expect(paths).toEqual([".trash.md", "c.md", "notes/a.md", "notes/deep/nest/b.md"]);
  });
});

describe("VaultService.buildIndex", () => {
  it("parses every scanned note into the index and removes stale notes", async () => {
    const { service, index } = setup({
      "vault/a.md": "# Alpha",
      "vault/sub/b.md": "# Beta",
    });
    index.upsert(makeNote("gone.md"));

    await service.buildIndex("vault");

    expect(index.all().map((n) => n.path).sort()).toEqual(["a.md", "sub/b.md"]);
    expect(index.removed).toContain("gone.md");
  });

  it("journals content hashes so unchanged watcher echoes are not re-parsed", async () => {
    const { service, index, parseNote } = setup({ "vault/a.md": "# Alpha" });
    await service.buildIndex("vault");
    const parsesAfterBuild = parseNote.mock.calls.length;

    service.applyChange("a.md", "update");
    await drainMicrotasks();

    expect(parseNote.mock.calls.length).toBe(parsesAfterBuild);
    expect(index.upserted.length).toBe(1);
  });
});

describe("VaultService.applyChange (debounce)", () => {
  it("processes nothing before 150ms and exactly once after", async () => {
    const { service, fs, parseNote, timer } = setup({ "vault/a.md": "# Alpha" });
    await service.buildIndex("vault");
    fs.files.set("vault/a.md", "# Alpha v2");
    service.applyChange("a.md", "update");

    timer.advance(VAULT_DEBOUNCE_MS - 1);
    await drainMicrotasks();
    expect(parseNote).toHaveBeenCalledTimes(1); // only the initial build

    timer.advance(1);
    await drainMicrotasks();
    expect(parseNote).toHaveBeenCalledTimes(2);
    expect(parseNote.mock.calls[1][0]).toBe("a.md");
  });

  it("re-schedules on repeated events (trailing debounce wins with latest content)", async () => {
    const { service, fs, parseNote, timer } = setup({ "vault/a.md": "# Alpha" });
    await service.buildIndex("vault");

    service.applyChange("a.md", "update");
    timer.advance(100);
    fs.files.set("vault/a.md", "# Alpha rewritten");
    service.applyChange("a.md", "update");

    timer.advance(VAULT_DEBOUNCE_MS - 1);
    await drainMicrotasks();
    expect(parseNote).toHaveBeenCalledTimes(1);

    timer.advance(1);
    await drainMicrotasks();
    expect(parseNote).toHaveBeenCalledTimes(2);
    expect(parseNote.mock.calls[1][1]).toContain("rewritten");
  });

  it("debounces per path, not globally", async () => {
    const { service, fs, parseNote, timer } = setup({
      "vault/a.md": "# Alpha",
      "vault/b.md": "# Beta",
    });
    await service.buildIndex("vault");
    parseNote.mockClear();
    fs.files.set("vault/a.md", "# Alpha v2");
    fs.files.set("vault/b.md", "# Beta v2");

    service.applyChange("a.md", "update");
    timer.advance(50);
    service.applyChange("b.md", "update");
    timer.advance(50);
    await drainMicrotasks();
    expect(parseNote).not.toHaveBeenCalled();

    timer.advance(VAULT_DEBOUNCE_MS - 50);
    await drainMicrotasks();
    expect(parseNote.mock.calls.map((c) => c[0]).sort()).toEqual(["a.md", "b.md"]);
  });

  it("normalizes Windows-style absolute watcher paths to vault-relative identity", async () => {
    const { service, fs, parseNote, timer } = setup({ "vault/a.md": "# Alpha" });
    await service.buildIndex("vault");
    parseNote.mockClear();
    fs.files.set("vault/a.md", "# Alpha v2");

    service.applyChange("vault\\a.md", "update");
    timer.advance(VAULT_DEBOUNCE_MS);
    await drainMicrotasks();

    expect(parseNote.mock.calls[0][0]).toBe("a.md");
  });

  it("removes the note on delete events without touching the filesystem", async () => {
    const { service, index, fs, timer } = setup({ "vault/a.md": "# Alpha" });
    await service.buildIndex("vault");
    const readsAfterBuild = fs.readTextCalls;

    service.applyChange("a.md", "delete");
    timer.advance(VAULT_DEBOUNCE_MS);
    await drainMicrotasks();

    expect(index.removed).toContain("a.md");
    expect(fs.readTextCalls).toBe(readsAfterBuild);
  });

  it("treats a vanished file (read error) as a removal", async () => {
    const { service, index, fs, timer } = setup({ "vault/a.md": "# Alpha" });
    await service.buildIndex("vault");
    fs.files.delete("vault/a.md");

    service.applyChange("a.md", "update");
    timer.advance(VAULT_DEBOUNCE_MS);
    await drainMicrotasks();

    expect(index.removed).toContain("a.md");
  });

  it("throws VaultNotOpenError before a vault is opened", () => {
    const { service } = setup();
    expect(() => service.applyChange("a.md", "update")).toThrowError(VaultNotOpenError);
  });
});

describe("VaultService.saveNote (self-write suppression + atomic contract)", () => {
  it("writes through FsPort, upserts the parsed note, and returns it", async () => {
    const { service, fs, index } = setup({}, ["vault"]);
    await service.buildIndex("vault");

    const note = await service.saveNote("a.md", "# Alpha\n\nBody");

    expect(fs.writes).toEqual([{ path: "vault/a.md", content: "# Alpha\n\nBody" }]);
    expect(note.path).toBe("a.md");
    expect(note.title).toBe("Alpha");
    expect(index.all().map((n) => n.path)).toEqual(["a.md"]);
  });

  it("suppresses the watcher echo of our own save (no re-parse, no re-upsert)", async () => {
    const { service, parseNote, index, timer } = setup({}, ["vault"]);
    await service.buildIndex("vault");
    await service.saveNote("a.md", "# Alpha");

    service.applyChange("a.md", "update"); // watcher echo of our own write
    timer.advance(VAULT_DEBOUNCE_MS);
    await drainMicrotasks();

    expect(parseNote).toHaveBeenCalledTimes(1); // only saveNote parsed
    expect(index.upserted.length).toBe(1);
  });

  it("still indexes genuine external edits after a self-write", async () => {
    const { service, fs, parseNote, index, timer } = setup({ "vault/a.md": "# Alpha" });
    await service.buildIndex("vault");
    await service.saveNote("a.md", "# Alpha v2");

    fs.files.set("vault/a.md", "# Alpha edited by user");
    service.applyChange("a.md", "update");
    timer.advance(VAULT_DEBOUNCE_MS);
    await drainMicrotasks();

    expect(parseNote).toHaveBeenCalledTimes(3); // build + save + external edit
    expect(index.upserted[index.upserted.length - 1].title).toBe("Alpha edited by user");
  });

  it("rejects before a vault is opened", async () => {
    const { service } = setup();
    await expect(service.saveNote("a.md", "# Alpha")).rejects.toThrowError(VaultNotOpenError);
  });
});

describe("VaultService.createStub", () => {
  it("creates a slug-named note with v1 frontmatter, upserts it, and suppresses its watcher echo", async () => {
    const { service, fs, index, parseNote, timer } = setup({}, ["vault"]);
    await service.buildIndex("vault");

    const rel = await service.createStub("vault", "The Weeping Gate");

    expect(rel).toBe("The Weeping Gate.md");
    const content = fs.files.get("vault/The Weeping Gate.md");
    expect(content).toContain("aliases: [The Weeping Gate]");
    expect(content).not.toMatch(/^type:/m); // type unset in stubs
    expect(content).toContain("# The Weeping Gate");
    expect(index.all().map((n) => n.title)).toContain("The Weeping Gate");

    service.applyChange(rel, "create"); // watcher echo
    timer.advance(VAULT_DEBOUNCE_MS);
    await drainMicrotasks();
    expect(parseNote).toHaveBeenCalledTimes(1);
    expect(index.upserted.length).toBe(1);
  });

  it("avoids filename collisions by appending a counter", async () => {
    const { service, fs } = setup({ "vault/Gate.md": "# Old gate" }, ["vault"]);

    const rel = await service.createStub("vault", "Gate");

    expect(rel).toBe("Gate 2.md");
    expect(fs.files.get("vault/Gate.md")).toBe("# Old gate"); // untouched
  });

  it("slugs unsafe characters out of the filename", async () => {
    const { service, fs } = setup({}, ["vault"]);

    const rel = await service.createStub("vault", 'What/If: "This"?');

    expect(rel).toBe("WhatIf This.md");
    expect(fs.files.has(`vault/${rel}`)).toBe(true);
  });
});

describe("VaultService.flushPending", () => {
  it("processes pending changes immediately, cancelling their timers", async () => {
    const { service, fs, parseNote, timer } = setup({ "vault/a.md": "# Alpha" });
    await service.buildIndex("vault");
    parseNote.mockClear();
    fs.files.set("vault/a.md", "# Alpha v2");

    service.applyChange("a.md", "update");
    expect(timer.pendingCount).toBe(1);

    await service.flushPending();

    expect(timer.pendingCount).toBe(0);
    expect(parseNote).toHaveBeenCalledTimes(1);
    timer.advance(VAULT_DEBOUNCE_MS * 2);
    await drainMicrotasks();
    expect(parseNote).toHaveBeenCalledTimes(1); // timer was cancelled, no double run
  });
});
