/**
 * M2 Wave C1 — Tauri invoke wrappers for the Wave-A1 keyring commands
 * (src-tauri/src/ai_key.rs) plus the Wave-A2 `ai_chat` proxy seam.
 *
 * Command shapes verified against ai_key.rs (do not guess):
 *   key_set(key: String)  -> Result<(), KeyringError>   // {kind,message} on error
 *   key_get_status()      -> Result<bool>               // presence only, NEVER the value
 *   key_delete()          -> Result<()>
 *
 * The pasted key enters Rust here and never returns: this module can only
 * set it and ask whether one is present (ADR-006 §2).
 */
import { invoke } from "@tauri-apps/api/core";
import type { AiResponse, ChatRequest } from "../../core/ai/types";

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

/**
 * Test-connection seam for the Rust `ai_chat` proxy (ADR-006 §1): the
 * renderer sends the request WITHOUT a credential and Rust injects the key
 * from the keyring.
 *
 * TODO(M2 A2): `ai_chat` was not registered when C1 landed (A2 is landing
 * concurrently — signature verified from src-tauri/src/ai_chat.rs WIP:
 * `#[tauri::command(async)] fn ai_chat(request: ChatRequest)` returning
 * `{content, usage?, latency_ms}`). When A2 commits, replace the throw:
 *   const raw = await invoke<{ content: string; usage?: TokenUsage; latency_ms: number }>(
 *     "ai_chat",
 *     { request: { baseUrl: req.baseUrl, model: req.model, messages: req.messages,
 *                  temperature: req.temperature, max_tokens: req.max_tokens } },
 *   );
 *   return { content: raw.content, usage: raw.usage, latencyMs: raw.latency_ms };
 */
export async function chatViaProxy(_req: ChatRequest): Promise<AiResponse> {
  throw new Error("ai_chat not available");
}
