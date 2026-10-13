/**
 * M2 Wave C1 — Tauri invoke wrappers for the Wave-A1 keyring commands
 * (src-tauri/src/ai_key.rs).
 *
 * Command shapes verified against ai_key.rs (do not guess):
 *   key_set(key: String)  -> Result<(), KeyringError>   // {kind,message} on error
 *   key_get_status()      -> Result<bool>               // presence only, NEVER the value
 *   key_delete()          -> Result<()>
 *
 * The pasted key enters Rust here and never returns: this module can only
 * set it and ask whether one is present (ADR-006 §2).
 *
 * The Wave-A2 `ai_chat` proxy seam now lives in ./ai-tauri (the Transport
 * adapter) and is re-exported here so existing call sites keep one import.
 */
import { invoke } from "@tauri-apps/api/core";

export { aiTransport, chatViaProxy, toAiError } from "./ai-tauri";

/** Store the pasted key in the OS keyring, replacing any existing value. */
export async function setAiKey(key: string): Promise<void> {
  await invoke("key_set", { key });
}

/** `true` iff a key is stored. Never returns key material. */
export async function getAiKeyStatus(): Promise<boolean> {
  return invoke<boolean>("key_get_status");
}

/** KeyringError is adjacently tagged in Rust: {kind, message} — surface the message. */
export function keyringErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return String(error);
}
