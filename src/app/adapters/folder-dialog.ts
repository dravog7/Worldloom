import { open } from "@tauri-apps/plugin-dialog";

/**
 * Native "open folder" dialog for choosing a vault (PLAN-M1 B3).
 * Returns the absolute folder path, or null when the user cancels.
 */
export async function pickVaultFolder(): Promise<string | null> {
  // `recursive: true` is load-bearing (M2.5 I3 fs scope): tauri-plugin-dialog
  // auto-allows exactly the picked path into the fs scope as
  // `allow_directory(path, recursive)`, and that runtime grant is now the
  // ONLY source of vault filesystem access — no static capability scope ships.
  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
    title: "Open vault folder",
  });
  return typeof selected === "string" ? selected : null;
}
