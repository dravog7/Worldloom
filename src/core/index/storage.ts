/**
 * Persistence port for the index sidecar (ADR-003).
 *
 * src/core must stay pure TypeScript (ARCH.md): no node:fs, no Tauri imports.
 * MemoryIndex therefore reaches storage through this interface — the app
 * layer (Wave B3/I1) injects an fs-backed adapter; tests and the default
 * wiring use the in-memory implementation below.
 */
export interface IndexStorage {
  /** Full sidecar contents, or null when nothing is stored (missing file). */
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

/** Default storage: keeps the sidecar string in memory (tests, headless use). */
export class MemoryIndexStorage implements IndexStorage {
  private contents: string | null = null;

  async read(): Promise<string | null> {
    return this.contents;
  }

  async write(contents: string): Promise<void> {
    this.contents = contents;
  }
}
