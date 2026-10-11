import { beforeEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}));

const storeMocks = vi.hoisted(() => {
  const instance = {
    get: vi.fn(async () => undefined as string | undefined),
    set: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
  };
  return { instance, load: vi.fn(async () => instance) };
});

const dialogMocks = vi.hoisted(() => ({ open: vi.fn(async () => null as string | null) }));

vi.mock("@tauri-apps/plugin-fs", () => fsMocks);
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: storeMocks.load } }));
vi.mock("@tauri-apps/plugin-dialog", () => dialogMocks);

import { TauriFsAdapter } from "./tauri-fs";
import { loadVaultPath, saveVaultPath, VAULT_PATH_KEY } from "./vault-path";
import { pickVaultFolder } from "./folder-dialog";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TauriFsAdapter", () => {
  it("writes atomically: temp sibling file first, then rename onto the destination", async () => {
    const adapter = new TauriFsAdapter();

    await adapter.writeText("C:/vault/note.md", "# Note");

    expect(fsMocks.writeTextFile).toHaveBeenCalledExactlyOnceWith(
      "C:/vault/note.md.tmp",
      "# Note",
    );
    expect(fsMocks.rename).toHaveBeenCalledExactlyOnceWith(
      "C:/vault/note.md.tmp",
      "C:/vault/note.md",
    );
    expect(fsMocks.writeTextFile.mock.invocationCallOrder[0]).toBeLessThan(
      fsMocks.rename.mock.invocationCallOrder[0],
    );
  });

  it("maps tauri DirEntry objects down to the FsPort DirEntry shape", async () => {
    fsMocks.readDir.mockResolvedValue([
      { name: "places", isDirectory: true, isFile: false, isSymlink: false },
      { name: "a.md", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    const adapter = new TauriFsAdapter();

    const entries = await adapter.readDir("C:/vault");

    expect(entries).toEqual([
      { name: "places", isDirectory: true },
      { name: "a.md", isDirectory: false },
    ]);
  });

  it("creates directories recursively by default", async () => {
    const adapter = new TauriFsAdapter();
    await adapter.mkdir("C:/vault/new/deep");
    expect(fsMocks.mkdir).toHaveBeenCalledExactlyOnceWith("C:/vault/new/deep", {
      recursive: true,
    });
  });
});

describe("vault path persistence (plugin-store)", () => {
  it("saves the vault path under the 'vaultPath' key and flushes to disk", async () => {
    await saveVaultPath("C:/vault");

    expect(storeMocks.load).toHaveBeenCalledWith("worldloom-settings.json");
    expect(storeMocks.instance.set).toHaveBeenCalledExactlyOnceWith(
      VAULT_PATH_KEY,
      "C:/vault",
    );
    expect(storeMocks.instance.save).toHaveBeenCalledTimes(1);
  });

  it("loads the stored vault path, or null when none is set", async () => {
    storeMocks.instance.get.mockResolvedValueOnce("C:/vault");
    expect(await loadVaultPath()).toBe("C:/vault");

    storeMocks.instance.get.mockResolvedValueOnce(undefined);
    expect(await loadVaultPath()).toBeNull();
  });
});

describe("pickVaultFolder (plugin-dialog)", () => {
  it("returns the chosen folder path", async () => {
    dialogMocks.open.mockResolvedValueOnce("C:/vault");
    expect(await pickVaultFolder()).toBe("C:/vault");
    expect(dialogMocks.open).toHaveBeenCalledExactlyOnceWith({
      directory: true,
      multiple: false,
      title: "Open vault folder",
    });
  });

  it("returns null when the dialog is cancelled", async () => {
    dialogMocks.open.mockResolvedValueOnce(null);
    expect(await pickVaultFolder()).toBeNull();
  });
});
