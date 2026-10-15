/**
 * M2.5 I3 — fs-scope hardening (Tauri v2 dynamic capability scoping).
 *
 * Tripwires, not coverage: they pin the two decisions that keep a compromised
 * renderer inside the opened vault.
 *  1. The shipped capability JSON grants NO blanket filesystem scope (no
 *     `$HOME/**`, no static `fs:scope` allow list). Vault access arrives one
 *     user-picked directory at a time at runtime.
 *  2. The vault picker asks for a RECURSIVE directory grant, because
 *     tauri-plugin-dialog auto-allows exactly what the picker returns into
 *     the fs scope (`allow_directory(path, options.recursive)`) — that grant
 *     is the only source of vault fs access now.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import { open } from "@tauri-apps/plugin-dialog";
import { pickVaultFolder } from "./folder-dialog";

const capabilityUrl = new URL("../../../src-tauri/capabilities/default.json", import.meta.url);

interface CapabilityEntry {
  identifier: string;
  allow?: unknown;
}

function loadCapability(): { raw: string; permissions: Array<string | CapabilityEntry> } {
  const raw = readFileSync(capabilityUrl, "utf8");
  return { raw, permissions: (JSON.parse(raw) as { permissions: Array<string | CapabilityEntry> }).permissions };
}

describe("capability scoping — no blanket fs scope ships (M2.5 I3)", () => {
  it("contains no $HOME expansion anywhere in the capability file", () => {
    const { raw } = loadCapability();
    expect(raw).not.toContain("$HOME");
  });

  it("declares no static fs:scope entry (all fs scope is granted at runtime)", () => {
    const { permissions } = loadCapability();
    for (const entry of permissions) {
      if (typeof entry === "string") {
        expect(entry).not.toBe("fs:scope");
      } else {
        expect(entry.identifier).not.toBe("fs:scope");
      }
    }
  });

  it("keeps the fs/dialog/store command permissions the vault flow needs", () => {
    const { permissions } = loadCapability();
    const strings = permissions.filter((p): p is string => typeof p === "string");
    for (const required of [
      "dialog:default",
      "store:default",
      "fs:default",
      "fs:allow-exists",
      "fs:allow-read-dir",
      "fs:allow-read-text-file",
      "fs:allow-write-text-file",
      "fs:allow-mkdir",
      "fs:allow-rename",
      "fs:allow-remove",
      "fs:allow-watch",
      "fs:allow-unwatch",
    ]) {
      expect(strings, `capability must keep ${required}`).toContain(required);
    }
  });
});

describe("pickVaultFolder — the dialog IS the fs grant (M2.5 I3)", () => {
  beforeEach(() => {
    vi.mocked(open).mockClear();
    vi.mocked(open).mockResolvedValue(null);
  });

  it("requests a single directory RECURSIVELY (recursive grant covers the whole vault)", async () => {
    const result = await pickVaultFolder();
    expect(result).toBeNull();
    expect(open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      recursive: true,
      title: "Open vault folder",
    });
  });

  it("returns the picked folder path unchanged", async () => {
    vi.mocked(open).mockResolvedValueOnce("C:/vaults/myworld");
    await expect(pickVaultFolder()).resolves.toBe("C:/vaults/myworld");
  });

  it("returns null when the picker yields a non-string (cancel / multi)", async () => {
    vi.mocked(open).mockResolvedValueOnce(null);
    await expect(pickVaultFolder()).resolves.toBeNull();
  });
});
