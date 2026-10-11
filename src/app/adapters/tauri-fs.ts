import {
  exists,
  mkdir,
  readDir as tauriReadDir,
  readTextFile,
  remove,
  rename as tauriRename,
  writeTextFile,
} from "@tauri-apps/plugin-fs";
import type { DirEntry, FsPort } from "../../core/vault";

/**
 * Tauri-backed FsPort (PLAN-M1 B3). The ONLY layer that talks to
 * @tauri-apps/plugin-fs; all vault logic stays in src/core behind the FsPort
 * interface (ARCH.md). writeText fulfils the atomic contract: temp sibling
 * file + rename, never truncate-then-write.
 */
export class TauriFsAdapter implements FsPort {
  async readDir(path: string): Promise<DirEntry[]> {
    const entries = await tauriReadDir(path);
    return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory }));
  }

  readText(path: string): Promise<string> {
    return readTextFile(path);
  }

  /** Atomic: write `<path>.tmp`, then rename over the destination. */
  async writeText(path: string, content: string): Promise<void> {
    const tmp = `${path}.tmp`;
    await writeTextFile(tmp, content);
    await tauriRename(tmp, path);
  }

  exists(path: string): Promise<boolean> {
    return exists(path);
  }

  mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    return mkdir(path, { recursive: options?.recursive ?? true });
  }

  rename(from: string, to: string): Promise<void> {
    return tauriRename(from, to);
  }

  remove(path: string): Promise<void> {
    return remove(path);
  }
}
