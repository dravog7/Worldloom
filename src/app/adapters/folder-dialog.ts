import { open } from "@tauri-apps/plugin-dialog";

/**
 * Native "open folder" dialog for choosing a vault (PLAN-M1 B3).
 * Returns the absolute folder path, or null when the user cancels.
 */
export async function pickVaultFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title: "Open vault folder" });
  return typeof selected === "string" ? selected : null;
}
