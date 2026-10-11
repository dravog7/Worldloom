import {
  mkdir as nodeMkdir,
  readFile,
  readdir,
  rename as nodeRename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { DirEntry, FsPort } from "../../core/vault";

/**
 * Node-backed FsPort for headless use of the real core: the vitest
 * integration smoke (scripts/smoke.test.ts) runs the actual VaultService
 * over the fixture vault through this adapter — no Tauri runtime needed.
 * writeText follows the same atomic temp+rename contract as TauriFsAdapter.
 */
export class NodeFsAdapter implements FsPort {
  async readDir(path: string): Promise<DirEntry[]> {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
  }

  readText(path: string): Promise<string> {
    return readFile(path, "utf8");
  }

  /** Atomic: write `<path>.tmp`, then rename over the destination. */
  async writeText(path: string, content: string): Promise<void> {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, content, "utf8");
    await nodeRename(tmp, path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await nodeMkdir(path, { recursive: options?.recursive ?? true });
  }

  rename(from: string, to: string): Promise<void> {
    return nodeRename(from, to);
  }

  remove(path: string): Promise<void> {
    return rm(path, { recursive: true, force: true });
  }
}
