/**
 * AI-layer shared contracts (ADR-006, M2).
 *
 * FROZEN by the orchestrator before Waves A/B fan out — A2 (Rust proxy + adapter),
 * B1 (client), and B2 (prompts/extract) all code against these exact shapes and
 * must NOT edit this file; report mismatches upward instead.
 *
 * The key never appears here: `ai_chat` reads it from the OS keyring inside Rust.
 */

/** One chat message in OpenAI wire shape. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** What the renderer sends to the transport. No secrets, ever. */
export interface ChatRequest {
  /** Base URL of an OpenAI-compatible endpoint, e.g. "https://api.openai.com/v1". */
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

/** Token accounting as reported by the provider (OpenAI `usage` shape). */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

/** Typed failure taxonomy — every AI surface maps these to user-facing copy. */
export type AiErrorKind =
  | "auth" // 401/403 or keyring says no key for a non-local endpoint
  | "http" // any other non-2xx
  | "timeout"
  | "invalid-response" // 2xx but not parseable OpenAI JSON
  | "network"
  | "no-key" // non-local endpoint and no key stored
  | "invalid-endpoint"; // scheme/host rejected before any socket (ADR-006 §3)

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.status = status;
  }
}

/** Successful completion. */
export interface AiResponse {
  content: string;
  usage?: TokenUsage;
  latencyMs: number;
}

/**
 * Injected transport — unit tests pass a mock; the Tauri adapter implements this
 * via `invoke('ai_chat', …)` (src/app/adapters/ai-tauri.ts). src/core never
 * imports Tauri (eslint-enforced, same discipline as M1).
 */
export interface Transport {
  chat(req: ChatRequest): Promise<AiResponse>;
}
