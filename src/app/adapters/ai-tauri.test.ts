/**
 * M2 I4 fix — the Tauri AI transport adapter (src/app/adapters/ai-tauri.ts).
 *
 * The blocker this file pins down: Rust `ai_chat` rejects with the adjacently
 * tagged `{kind, message}` object (src-tauri/src/ai_chat.rs), but nothing on
 * the TS side ever turned that into the frozen `AiError` class — so every
 * `instanceof AiError` consumer (AiClient retry policy, friendlyAiError in the
 * Ask panel) silently fell through on the real transport. These tests force
 * the taxonomy to stay alive across the invoke boundary.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { AiClient } from "../../core/ai/client";
import { AiError, type ChatRequest } from "../../core/ai/types";
import { aiTransport, chatViaProxy, toAiError } from "./ai-tauri";

const REQUEST: ChatRequest = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "ping" }],
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("toAiError — Rust {kind,message} → frozen TS AiError", () => {
  it("preserves every kebab-case kind and its message", () => {
    for (const kind of [
      "auth",
      "http",
      "timeout",
      "invalid-response",
      "network",
      "no-key",
      "invalid-endpoint",
    ] as const) {
      const mapped = toAiError({ kind, message: `provider says (${kind})` });
      expect(mapped).toBeInstanceOf(AiError);
      expect(mapped.kind).toBe(kind);
      expect(mapped.message).toBe(`provider says (${kind})`);
    }
  });

  it("recovers the HTTP status from the Rust message so retries can fire", () => {
    const rateLimited = toAiError({
      kind: "http",
      message: "http error: provider returned HTTP 429 — slow down",
    });
    expect(rateLimited.status).toBe(429);

    const unauthorized = toAiError({
      kind: "auth",
      message: "auth error: provider rejected the request (HTTP 401); check key",
    });
    expect(unauthorized.status).toBe(401);
  });

  it("leaves status undefined when the message carries no HTTP code", () => {
    expect(toAiError({ kind: "timeout", message: "no response within 120s" }).status).toBe(
      undefined,
    );
  });

  it("falls back to network for shapes outside the frozen taxonomy", () => {
    for (const weird of [
      { kind: "self-destruct", message: "boom" },
      { kind: "auth" }, // no message
      "invalid command arguments",
      42,
      null,
      undefined,
    ]) {
      const mapped = toAiError(weird);
      expect(mapped).toBeInstanceOf(AiError);
      expect(mapped.kind).toBe("network");
      expect(mapped.message.length).toBeGreaterThan(0);
    }
  });

  it("passes an already-mapped AiError through untouched (idempotent)", () => {
    const original = new AiError("auth", "key rejected", 401);
    expect(toAiError(original)).toBe(original);
  });
});

describe("chatViaProxy — invoke seam", () => {
  it("maps the frozen ChatResponse to AiResponse and camelCases latency", async () => {
    invokeMock.mockResolvedValueOnce({
      content: "Hello!",
      usage: { prompt_tokens: 3, completion_tokens: 2 },
      latency_ms: 42,
    });
    const reply = await chatViaProxy(REQUEST);
    expect(reply).toEqual({
      content: "Hello!",
      usage: { prompt_tokens: 3, completion_tokens: 2 },
      latencyMs: 42,
    });
    expect(invokeMock).toHaveBeenCalledExactlyOnceWith("ai_chat", {
      request: {
        baseUrl: REQUEST.baseUrl,
        model: REQUEST.model,
        messages: REQUEST.messages,
        temperature: undefined,
        max_tokens: undefined,
      },
    });
  });

  it("rethrows a Rust rejection as a typed AiError (no raw {kind,message})", async () => {
    invokeMock.mockRejectedValueOnce({
      kind: "no-key",
      message: "no API key stored — save one with key_set",
    });
    await expect(chatViaProxy(REQUEST)).rejects.toMatchObject({
      name: "AiError",
      kind: "no-key",
    });
  });
});

describe("aiTransport — taxonomy alive end-to-end through AiClient", () => {
  it("retries a Rust HTTP 429 rejection and succeeds on the next attempt", async () => {
    invokeMock
      .mockRejectedValueOnce({
        kind: "http",
        message: "http error: provider returned HTTP 429 — slow down",
      })
      .mockResolvedValueOnce({ content: "ok", latency_ms: 5 });

    const slept: number[] = [];
    const client = new AiClient(aiTransport, {
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    const reply = await client.chat(REQUEST);

    expect(reply.content).toBe("ok");
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([250]); // DEFAULT_RETRY_POLICY.baseDelayMs
  });

  it("does NOT retry a Rust auth rejection (first attempt surfaces)", async () => {
    invokeMock.mockRejectedValue({
      kind: "auth",
      message: "auth error: provider rejected the request (HTTP 401)",
    });

    const client = new AiClient(aiTransport, { sleep: async () => {} });
    await expect(client.chat(REQUEST)).rejects.toMatchObject({ kind: "auth", status: 401 });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
