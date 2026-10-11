import { Store } from "@tauri-apps/plugin-store";

/** App-data settings file (NOT in the vault — ADR-002: vault = markdown only). */
const SETTINGS_FILE = "worldloom-settings.json";
export const VAULT_PATH_KEY = "vaultPath";

/** Remembers the last opened vault across app restarts. */
export async function loadVaultPath(): Promise<string | null> {
  const store = await Store.load(SETTINGS_FILE);
  return (await store.get<string>(VAULT_PATH_KEY)) ?? null;
}

export async function saveVaultPath(path: string): Promise<void> {
  const store = await Store.load(SETTINGS_FILE);
  await store.set(VAULT_PATH_KEY, path);
  await store.save();
}
