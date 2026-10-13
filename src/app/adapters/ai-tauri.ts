/**
 * M2 I4 — the Tauri AI transport adapter: the `Transport` implementation the
 * frozen contracts in src/core/ai/types.ts + transport.ts reference.
 *
 * Why this module exists (the I4 blocker it fixes): Rust `ai_chat` rejects
 * with the adjacently-tagged `{kind, message}` object (src-tauri/src/ai_chat.rs),
 * but at the invoke boundary that arrives as a plain object — NOT an instance
 * of the frozen TS `AiError` class. Every downstream `instanceof AiError`
 * consumer (the AiClient 429/5xx retry policy, `friendlyAiError` in the Ask
 * panel, typed-error handling in llm.ts) silently fell through on the real
 * transport while mocks behaved perfectly. `toAiError` is the single choke
 * point that keeps the taxonomy alive end-to-end.
 *
 * Status recovery: the Rust taxonomy carries no `status` field — the code is
 * embedded in the message text ("… HTTP 429 — …", "… (HTTP 401); …"), which
 * `toAiError` parses back out so the client retry policy (429/5xx only) can
 * make its decision on the real transport. Unknown rejection shapes degrade
 * to `kind: "network"` — never a raw object into the UI.
 *
 * The key never appears in this module: `ai_chat` reads it from the OS
 * keyring inside Rust (ADR-006 §1).
 */
import { invoke } from "@tauri-apps/api/core";
import {
  AiError,
  type AiErrorKind,
  type AiResponse,
  type ChatRequest,
  type Transport,
} from "../../core/ai/types";

/** The frozen AiErrorKind union (src/core/ai/types.ts), as a runtime set. */
const AI_ERROR_KINDS: ReadonlySet<string> = new Set<AiErrorKind>([
  "auth",
  "http",
  "timeout",
  "invalid-response",
  "network",
  "no-key",
  "invalid-endpoint",
]);

/** "… HTTP 429 …" / "… (HTTP 401) …" — how Rust embeds the status in messages. */
const HTTP_STATUS_RE = /\bHTTP (\d{3})\b/;

/**
 * Map an `invoke('ai_chat')` rejection onto the frozen TS `AiError`.
 *
 * - `{kind, message}` with a known kebab-case kind → same kind, message kept,
 *   HTTP status recovered from the message text when present.
 * - Anything else (command-not-found strings, serde arg failures, JS errors)
 *   → `kind: "network"` with a stringified message — never `[object Object]`.
 * - An `AiError` passes through untouched (idempotent).
 */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (typeof error === "object" && error !== null && "kind" in error) {
    const candidate = error as { kind?: unknown; message?: unknown };
    const { kind, message } = candidate;
    // Strict on the frozen wire shape: kebab-case kind + string message, or
    // the rejection is treated as unknown and falls through.
    if (typeof kind === "string" && AI_ERROR_KINDS.has(kind) && typeof message === "string") {
      const status = HTTP_STATUS_RE.exec(message);
      return new AiError(kind as AiErrorKind, message, status ? Number(status[1]) : undefined);
    }
  }
  return new AiError("network", typeof error === "string" ? error : String(error));
}

/**
 * `invoke('ai_chat', …)` with the frozen wire shapes (do not guess against
 * ai_chat.rs):
 *   ChatRequest  { baseUrl, model, messages, temperature?, max_tokens? }
 *   ChatResponse { content, usage?, latency_ms }
 * Rejections are rethrown as typed `AiError`s via {@link toAiError}.
 */
export async function chatViaProxy(req: ChatRequest): Promise<AiResponse> {
  try {
    const raw = await invoke<{
      content: string;
      usage?: { prompt_tokens: number; completion_tokens: number };
      latency_ms: number;
    }>("ai_chat", {
      request: {
        baseUrl: req.baseUrl,
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        max_tokens: req.max_tokens,
      },
    });
    return { content: raw.content, usage: raw.usage, latencyMs: raw.latency_ms };
  } catch (error) {
    throw toAiError(error);
  }
}

/** The app's `Transport` for the Rust proxy (ADR-006 §1): no key, typed errors. */
export const aiTransport: Transport = { chat: chatViaProxy };
