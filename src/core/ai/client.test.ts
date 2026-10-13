import { describe, expect, it } from "vitest";
import { AiError, type AiResponse, type ChatRequest } from "./types";
import type { Transport } from "./transport";
import {
  AiClient,
  PROVIDER_PRESETS,
  buildChatRequest,
  resolveProvider,
  type RetryPolicy,
} from "./client";

/** Scripted mock transport — zero network (ADR-006 §4, M2 plan rules). */
class MockTransport implements Transport {
  readonly calls: ChatRequest[] = [];
  private readonly script: (() => Promise<AiResponse>)[];

  constructor(script: (() => Promise<AiResponse>)[]) {
    this.script = [...script];
  }

  async chat(req: ChatRequest): Promise<AiResponse> {
    this.calls.push(req);
    const next = this.script.shift();
    if (!next) throw new Error("MockTransport: no scripted response left");
    return next();
  }
}

function ok(delayMs = 12): () => Promise<AiResponse> {
  return () =>
    Promise.resolve({
      content: "pong",
      usage: { prompt_tokens: 3, completion_tokens: 1 },
      latencyMs: delayMs,
    });
}

function httpError(status: number): () => Promise<AiResponse> {
  return () =>
    Promise.reject(
      new AiError(status === 401 ? "auth" : "http", `HTTP ${status}`, status),
    );
}

/** Client under test with a recorded sleep so backoff is asserted, not awaited. */
function makeClient(
  script: (() => Promise<AiResponse>)[],
  policy?: Partial<RetryPolicy>,
): { client: AiClient; transport: MockTransport; sleeps: number[] } {
  const transport = new MockTransport(script);
  const sleeps: number[] = [];
  const client = new AiClient(transport, {
    retry: policy,
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { client, transport, sleeps };
}

const REQ: ChatRequest = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "ping" }],
};

describe("buildChatRequest — OpenAI-completions request builder", () => {
  it("passes through model, messages, temperature and max_tokens", () => {
    const req = buildChatRequest({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
      temperature: 0.2,
      max_tokens: 512,
    });
    expect(req).toEqual({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      temperature: 0.2,
      max_tokens: 512,
    });
  });

  it("omits optional fields when not provided", () => {
    const req = buildChatRequest({
      baseUrl: "https://api.openai.com/v1",
      model: "m",
      messages: [{ role: "user", content: "x" }],
    });
    expect("temperature" in req).toBe(false);
    expect("max_tokens" in req).toBe(false);
  });

  it("carries no API key — the key must never enter the renderer (ADR-006 §1)", () => {
    const req = buildChatRequest({
      baseUrl: "https://api.openai.com/v1",
      model: "m",
      messages: [{ role: "user", content: "x" }],
    });
    expect(Object.keys(req).sort()).toEqual([
      "baseUrl",
      "messages",
      "model",
    ]);
  });

  it("rejects a non-https remote endpoint before any socket (ADR-006 §3)", () => {
    expect(() =>
      buildChatRequest({
        baseUrl: "http://evil.com/v1",
        model: "m",
        messages: [],
      }),
    ).toThrowError(AiError);
    try {
      buildChatRequest({ baseUrl: "http://evil.com/v1", model: "m", messages: [] });
    } catch (e) {
      expect((e as AiError).kind).toBe("invalid-endpoint");
    }
  });

  it("rejects a non-http(s) scheme (e.g. ftp:) with invalid-endpoint", () => {
    try {
      buildChatRequest({ baseUrl: "ftp://api.example.com", model: "m", messages: [] });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as AiError).kind).toBe("invalid-endpoint");
    }
  });

  it("accepts http only for localhost/127.0.0.1 (Ollama, ADR-006 §3)", () => {
    expect(() =>
      buildChatRequest({ baseUrl: "http://127.0.0.1:11434/v1", model: "m", messages: [] }),
    ).not.toThrow();
    expect(() =>
      buildChatRequest({ baseUrl: "http://localhost:11434/v1", model: "m", messages: [] }),
    ).not.toThrow();
  });

  it("rejects http on any other host", () => {
    expect(() =>
      buildChatRequest({ baseUrl: "http://192.168.1.5:11434/v1", model: "m", messages: [] }),
    ).toThrowError(AiError);
  });
});

describe("resolveProvider — preset resolution", () => {
  it("resolves openai to the official base URL with models", () => {
    const p = resolveProvider("openai");
    expect(p.baseUrl).toBe("https://api.openai.com/v1");
    expect(p.models.length).toBeGreaterThan(0);
    expect(p.requiresKey).toBe(true);
  });

  it("resolves openrouter with an OpenAI-compatible base URL", () => {
    const p = resolveProvider("openrouter");
    expect(p.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(p.models.length).toBeGreaterThan(0);
  });

  it("resolves opencode-zen with its gateway base URL", () => {
    const p = resolveProvider("opencode-zen");
    expect(p.baseUrl).toBe("https://opencode.ai/zen/v1");
    expect(p.models.length).toBeGreaterThan(0);
  });

  it("resolves ollama as local, keyless, localhost base URL", () => {
    const p = resolveProvider("ollama");
    expect(p.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(p.requiresKey).toBe(false);
  });

  it("custom requires a caller-supplied baseUrl", () => {
    expect(() => resolveProvider("custom")).toThrowError(AiError);
    const p = resolveProvider("custom", { baseUrl: "https://llm.corp.example/v1" });
    expect(p.baseUrl).toBe("https://llm.corp.example/v1");
  });

  it("custom rejects an invalid supplied baseUrl with invalid-endpoint", () => {
    try {
      resolveProvider("custom", { baseUrl: "http://evil.com" });
      throw new Error("expected throw");
    } catch (e) {
      expect((e as AiError).kind).toBe("invalid-endpoint");
    }
  });

  it("unknown preset id throws invalid-endpoint", () => {
    try {
      resolveProvider("nope" as never);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as AiError).kind).toBe("invalid-endpoint");
    }
  });

  it("every built-in preset except custom has models and a valid baseUrl", () => {
    for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset.id, id).toBe(id);
      if (id === "custom") continue;
      expect(preset.models.length, id).toBeGreaterThan(0);
      expect(() =>
        buildChatRequest({ baseUrl: preset.baseUrl, model: preset.models[0]!, messages: [] }),
      ).not.toThrow();
    }
  });
});

describe("AiClient — retry policy (2 retries, 429/5xx only)", () => {
  it("returns the first success without retrying", async () => {
    const { client, transport, sleeps } = makeClient([ok()]);
    const res = await client.chat(REQ);
    expect(res.content).toBe("pong");
    expect(transport.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("retries on 429 then returns the eventual success", async () => {
    const { client, transport, sleeps } = makeClient([httpError(429), httpError(429), ok()]);
    const res = await client.chat(REQ);
    expect(res.content).toBe("pong");
    expect(transport.calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it("retries on 500 then returns the eventual success", async () => {
    const { client, transport } = makeClient([httpError(503), ok()]);
    const res = await client.chat(REQ);
    expect(res.content).toBe("pong");
    expect(transport.calls).toHaveLength(2);
  });

  it("does NOT retry on 400 — one call, error propagates", async () => {
    const { client, transport, sleeps } = makeClient([httpError(400)]);
    await expect(client.chat(REQ)).rejects.toMatchObject({ kind: "http", status: 400 });
    expect(transport.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it("does NOT retry on 401 — auth error surfaces immediately", async () => {
    const { client, transport } = makeClient([httpError(401)]);
    await expect(client.chat(REQ)).rejects.toMatchObject({ kind: "auth", status: 401 });
    expect(transport.calls).toHaveLength(1);
  });

  it("does NOT retry on timeout — typed error propagates after one call", async () => {
    const { client, transport } = makeClient([
      () => Promise.reject(new AiError("timeout", "request timed out")),
    ]);
    await expect(client.chat(REQ)).rejects.toMatchObject({ kind: "timeout" });
    expect(transport.calls).toHaveLength(1);
  });

  it("does NOT retry on abort — transport rejection propagates unchanged", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    const { client, transport } = makeClient([
      () => Promise.reject(abortError),
    ]);
    await expect(client.chat(REQ)).rejects.toBe(abortError);
    expect(transport.calls).toHaveLength(1);
  });

  it("exhausts 2 retries on persistent 5xx and rethrows the last error", async () => {
    const { client, transport, sleeps } = makeClient([
      httpError(500),
      httpError(500),
      httpError(500),
    ]);
    await expect(client.chat(REQ)).rejects.toMatchObject({ status: 500 });
    expect(transport.calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it("backoff grows exponentially from the configured base delay", async () => {
    const { client, sleeps } = makeClient(
      [httpError(429), httpError(429), ok()],
      { baseDelayMs: 100, maxDelayMs: 10_000 },
    );
    await client.chat(REQ);
    expect(sleeps).toEqual([100, 200]);
  });

  it("backoff is capped at maxDelayMs", async () => {
    const { client, sleeps } = makeClient(
      [httpError(500), httpError(500), ok()],
      { baseDelayMs: 1_000, maxDelayMs: 1_200 },
    );
    await client.chat(REQ);
    expect(sleeps).toEqual([1_000, 1_200]);
  });

  it("honors a maxRetries override of 0 (single attempt)", async () => {
    const { client, transport } = makeClient([httpError(429), ok()], { maxRetries: 0 });
    await expect(client.chat(REQ)).rejects.toMatchObject({ status: 429 });
    expect(transport.calls).toHaveLength(1);
  });

  it("forwards the request unchanged on every attempt", async () => {
    const { client, transport } = makeClient([httpError(429), ok()]);
    await client.chat(REQ);
    expect(transport.calls[0]).toBe(REQ);
    expect(transport.calls[1]).toBe(REQ);
  });

  it("preserves usage and latencyMs from the successful response", async () => {
    const { client } = makeClient([httpError(429), ok(77)]);
    const res = await client.chat(REQ);
    expect(res).toEqual({
      content: "pong",
      usage: { prompt_tokens: 3, completion_tokens: 1 },
      latencyMs: 77,
    });
  });
});

describe("core purity (M2 plan gates)", () => {
  it("src/core/ai sources import nothing from @tauri-apps (eslint-enforced, asserted here too)", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    for (const file of ["./client.ts", "./transport.ts", "./types.ts"]) {
      const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(src, file).not.toContain("@tauri-apps");
    }
  });
});
