/**
 * Pure-TS AI client: provider presets, request building, retry policy.
 * M2 Wave B1 (PLAN-M2.md). Zero network, zero Tauri — the network lives behind
 * the injected `Transport` (ADR-006 §4); the API key lives in the OS keyring
 * and never reaches this layer (ADR-006 §1), so `ChatRequest` carries no
 * credential field by construction.
 */
import { AiError, type AiResponse, type ChatRequest, type Transport } from "./transport";

/* ------------------------------------------------------------------ *
 * Provider presets (ADR-006: presets only choose baseUrl + models; the
 * wire protocol is OpenAI chat-completions everywhere).
 * ------------------------------------------------------------------ */

export type PresetId = "openai" | "openrouter" | "opencode-zen" | "ollama" | "custom";

export interface ProviderPreset {
  id: PresetId;
  label: string;
  /** OpenAI-compatible base URL. Empty for `custom` until supplied. */
  baseUrl: string;
  /** Suggested models. User-editable; empty for `custom`. */
  models: string[];
  /** Local endpoints (Ollama) need no key; everything remote does. */
  requiresKey: boolean;
}

export const PROVIDER_PRESETS: Record<PresetId, ProviderPreset> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o"],
    requiresKey: true,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
    requiresKey: true,
  },
  "opencode-zen": {
    id: "opencode-zen",
    label: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    models: ["big-pickle", "deepseek-v4-flash-free"],
    requiresKey: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: ["llama3.2"],
    requiresKey: false,
  },
  custom: {
    id: "custom",
    label: "Custom OpenAI-compatible",
    baseUrl: "",
    models: [],
    requiresKey: true,
  },
};

/** Base URL to ship in `ChatRequest`: preset default or a caller-supplied override. */
export function resolveProvider(
  id: PresetId,
  overrides?: { baseUrl?: string },
): ProviderPreset {
  const preset = PROVIDER_PRESETS[id];
  if (!preset) {
    throw new AiError("invalid-endpoint", `Unknown provider preset: ${String(id)}`);
  }
  if (id === "custom") {
    if (!overrides?.baseUrl) {
      throw new AiError(
        "invalid-endpoint",
        "Custom provider requires a baseUrl (OpenAI-compatible endpoint)",
      );
    }
    assertEndpointAllowed(overrides.baseUrl);
    return { ...preset, baseUrl: overrides.baseUrl };
  }
  if (overrides?.baseUrl) {
    // A user-edited base URL on a known preset gets the same validation.
    assertEndpointAllowed(overrides.baseUrl);
    return { ...preset, baseUrl: overrides.baseUrl };
  }
  return { ...preset };
}

/* ------------------------------------------------------------------ *
 * Endpoint scheme validation (mirrors ADR-006 §3 — Rust re-checks it
 * before any socket; this is the fast-fail copy for UI feedback).
 * ------------------------------------------------------------------ */

/** https everywhere; http only for loopback (Ollama). */
export function assertEndpointAllowed(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AiError("invalid-endpoint", `Not a valid URL: ${baseUrl}`);
  }
  if (url.protocol === "https:") return;
  const isLoopback =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
  if (isLoopback) return;
  throw new AiError(
    "invalid-endpoint",
    `Endpoint must use https (http only for localhost): ${baseUrl}`,
  );
}

/* ------------------------------------------------------------------ *
 * Request builder
 * ------------------------------------------------------------------ */

export interface ChatRequestInput {
  baseUrl: string;
  model: string;
  messages: ChatRequest["messages"];
  temperature?: number;
  max_tokens?: number;
}

/**
 * Build the wire request. Validates the endpoint scheme first so a bad base
 * URL fails before any socket, and copies only known fields — an API key
 * cannot leak through this shape.
 */
export function buildChatRequest(input: ChatRequestInput): ChatRequest {
  assertEndpointAllowed(input.baseUrl);
  const req: ChatRequest = {
    baseUrl: input.baseUrl,
    model: input.model,
    messages: input.messages,
  };
  if (input.temperature !== undefined) req.temperature = input.temperature;
  if (input.max_tokens !== undefined) req.max_tokens = input.max_tokens;
  return req;
}

/* ------------------------------------------------------------------ *
 * Retry policy — 2 retries, exponential backoff, 429/5xx only.
 * ------------------------------------------------------------------ */

export interface RetryPolicy {
  /** Extra attempts after the first (default 2 → ≤3 transport calls). */
  maxRetries: number;
  /** First-backoff seed in ms (doubles each retry). */
  baseDelayMs: number;
  /** Backoff ceiling in ms. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
};

/** Only rate-limit and server errors are transient enough to retry (PLAN-M2 B1). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryable(err: unknown): boolean {
  return (
    err instanceof AiError && err.status !== undefined && isRetryableStatus(err.status)
  );
}

export interface AiClientOptions {
  retry?: Partial<RetryPolicy>;
  /** Injected for tests; defaults to a real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retrying façade over an injected Transport. Retries only 429/5xx `AiError`s;
 * auth, timeout, abort, invalid-response and everything else surface on the
 * first attempt.
 */
export class AiClient {
  private readonly transport: Transport;
  private readonly policy: RetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(transport: Transport, options: AiClientOptions = {}) {
    this.transport = transport;
    this.policy = { ...DEFAULT_RETRY_POLICY, ...options.retry };
    this.sleep = options.sleep ?? defaultSleep;
  }

  async chat(req: ChatRequest): Promise<AiResponse> {
    const maxAttempts = Math.max(1, this.policy.maxRetries + 1);
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.transport.chat(req);
      } catch (err) {
        lastError = err;
        const isLast = attempt === maxAttempts - 1;
        if (isLast || !isRetryable(err)) throw err;
        const delay = Math.min(
          this.policy.baseDelayMs * 2 ** attempt,
          this.policy.maxDelayMs,
        );
        await this.sleep(delay);
      }
    }
    // Unreachable: the loop either returns or throws.
    throw lastError;
  }
}
