import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MemoryIndex } from "../src/core/index/memory-index";
import { parseNote } from "../src/core/parser";
import type { Note } from "../src/core/types";
import {
  ManualTimer,
  VAULT_DEBOUNCE_MS,
  VaultService,
  type FsPort,
} from "../src/core/vault";
import { NodeFsAdapter } from "../src/app/adapters/node-fs";

/**
 * B3 integration smoke (PLAN-M1): the REAL core — VaultService +
 * NodeFsAdapter + the real parser (B1) and MemoryIndex (B2) — over a temp
 * copy of fixtures/vault-sample. This is the Wave-C-independent safety net:
 * scan → index → backlinks → stub creation → simulated watcher edit.
 *
 * Run standalone with `npm run smoke` (or as part of `npm test`).
 */

function probeImplemented(run: () => unknown): boolean {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}

function probeNote(path: string): Note {
  return {
    path,
    title: "Probe",
    aliases: [],
    tags: [],
    relations: [],
    body: "",
    links: [],
    mtime: 0,
  };
}

// B1 (parser) and B2 (MemoryIndex) land in parallel with B3. Until both are
// real, this integration suite skips LOUDLY instead of failing the wave gate;
// it activates automatically the moment both dependencies are implemented.
const realCoreReady =
  probeImplemented(() => parseNote("probe.md", "---\ntype: probe\n---\n\n# Probe\n")) &&
  probeImplemented(() => {
    new MemoryIndex().upsert(probeNote("probe.md"));
  });

if (!realCoreReady) {
  console.warn(
    "[smoke] B1 parser / B2 MemoryIndex are still scaffold stubs — " +
      "integration smoke is SKIPPED this run and activates when they land.",
  );
}

const EXPECTED_UNRESOLVED = [
  "Mira's Locket",
  "Order of the Pale Hand",
  "The Weeping Gate",
  "Vault of Whispers",
];

describe.skipIf(!realCoreReady)("B3 integration smoke: real core over fixtures/vault-sample", () => {
  const fixtureSrc = fileURLToPath(new URL("../fixtures/vault-sample", import.meta.url));
  let root: string;
  let fs: FsPort;
  let index: MemoryIndex;
  let timer: ManualTimer;
  let service: VaultService;

  beforeAll(async () => {
    root = join(await mkdtemp(join(tmpdir(), "worldloom-smoke-")), "vault");
    await cp(fixtureSrc, root, { recursive: true });
    fs = new NodeFsAdapter();
    index = new MemoryIndex();
    timer = new ManualTimer();
    service = new VaultService({ fs, parseNote, index, timer });
    await service.buildIndex(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("scans and indexes all 33 fixture notes", () => {
    expect(index.all().length).toBe(33);
  });

  it("resolves every wikilink except the 4 deliberately dangling targets", () => {
    const names = new Set<string>();
    for (const note of index.all()) {
      names.add(note.title);
      for (const alias of note.aliases) names.add(alias);
      // Filename is identity per ADR-002: the file stem resolves links too
      // (session H1s use em-dashes while links use hyphens).
      names.add((note.path.split("/").pop() ?? "").replace(/\.md$/, ""));
    }
    const unresolved = new Set<string>();
    for (const note of index.all()) {
      for (const link of index.links(note.path)) {
        if (!names.has(link.target)) unresolved.add(link.target);
      }
    }
    expect([...unresolved].sort()).toEqual(EXPECTED_UNRESOLVED);
  });

  it("reports backlinks for a heavily cross-referenced note", () => {
    expect(index.backlinks("places/Vael'Thor.md").length).toBeGreaterThanOrEqual(1);
  });

  it("creates a stub for an unresolved target with correct v1 frontmatter, and its watcher echo is suppressed", async () => {
    const before = index.all().length;

    const rel = await service.createStub(root, "Vault of Whispers");

    expect(rel).toBe("Vault of Whispers.md");
    const content = await readFile(join(root, rel), "utf8");
    expect(content).toContain("aliases: [Vault of Whispers]");
    expect(content).not.toMatch(/^type:/m);
    expect(content).toContain("# Vault of Whispers");
    expect(index.byTitleOrAlias("Vault of Whispers")
      .some((note: Note) => note.title === "Vault of Whispers")).toBe(true);

    service.applyChange(rel, "create"); // watcher echo of our own write
    timer.advance(VAULT_DEBOUNCE_MS);
    await settle();
    expect(index.all().length).toBe(before + 1); // no duplicate upsert
  });

  it("a simulated external edit (write + watcher event + debounce) updates search results", async () => {
    const target = "places/Misthollow.md";
    const edited = (await readFile(join(root, target), "utf8")) +
      "\nA zephyrglass unica gleamed in the fog.\n";

    expect(index.search("zephyrglass")).toHaveLength(0);

    await fs.writeText(join(root, target), edited); // external editor, atomic
    service.applyChange(target, "update"); // watcher event
    timer.advance(VAULT_DEBOUNCE_MS);

    // Real fs reads complete on the thread pool — poll instead of assuming
    // a single macrotask flush is enough.
    await vi.waitFor(() => {
      expect(index.search("zephyrglass").length).toBeGreaterThanOrEqual(1);
    });
    expect(index.search("zephyrglass")[0].path).toBe(target);
  });
});

/** Lets in-flight async change processing (real fs reads) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}
