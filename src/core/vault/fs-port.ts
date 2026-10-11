/**
 * Filesystem port — the hexagonal boundary through which VaultService talks
 * to disk. Core stays pure (ARCH.md) because everything behind this port is
 * injectable: TauriFsAdapter in the app, NodeFsAdapter in smoke tests,
 * FakeFs in unit tests.
 */
export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/**
 * Atomic-write contract (ARCH.md Reliability pillar, pre-mortem risk #2):
 * `writeText` implementations MUST write a `.tmp` sibling first and then
 * rename it over the destination — never truncate-then-write — so a crash
 * mid-save can never corrupt a note.
 */
export interface FsPort {
  readDir(path: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string>;
  /** Atomic: write sibling `<path>.tmp`, then rename onto `path`. */
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}
