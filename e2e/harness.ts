/**
 * E2E harness wiring (Wave E1): computes the fixture-vault manifest in Node
 * and injects the Tauri-bridge mock (tauri-mock.js) into the page before any
 * app script runs. The app then boots in a plain browser believing it is
 * inside Tauri: settings store, fs, dialog and the AI commands all resolve
 * against the mock (see e2e/tauri-mock.js for the command table).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** Virtual vault root the mock serves (header shows its last segment). */
export const VAULT_ROOT = "/e2e-vault";
/** Repo-relative fixture vault backing the virtual root (served by Vite). */
export const FIXTURE_DIR = "fixtures/vault-sample";

interface VaultManifest {
  dirs: string[];
  files: string[];
}

/** Walk fixtures/vault-sample → vault-relative dirs + .md files. */
export function vaultManifest(): VaultManifest {
  const dirs: string[] = [];
  const files: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(FIXTURE_DIR, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        dirs.push(child);
        walk(child);
      } else if (/\.md$/i.test(entry.name)) {
        files.push(child);
      }
    }
  };
  walk("");
  return { dirs, files };
}

/**
 * Install the mock into `page` before the app's module scripts execute.
 * Settings seed: the store already points at the fixture vault, so boot()
 * goes straight to `openVaultRoot` (no dialog needed).
 */
export async function initTauriMock(page: Page): Promise<void> {
  const manifest = vaultManifest();
  const config = {
    vaultRoot: VAULT_ROOT,
    fixturePrefix: `/${FIXTURE_DIR}`,
    ...manifest,
    seedStore: { "worldloom-settings.json": { vaultPath: VAULT_ROOT } },
  };
  await page.addInitScript((cfg) => {
    (window as unknown as { __E2E_CONFIG__: unknown }).__E2E_CONFIG__ = cfg;
  }, config);
  await page.addInitScript({ path: "e2e/tauri-mock.js" });
}
