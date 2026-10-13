/**
 * M2 Wave C2 — AI capability gate, pure logic (PRD-M2 §5).
 *
 * The contract this file locks down: an AI surface is `configured` only when
 * the endpoint is an allowed URL, a model is chosen, and a key is stored for
 * remote providers. Local (loopback) endpoints need no key. Anything else
 * must degrade to the setup CTA — never to an `ai_chat` invocation.
 */
import { describe, expect, it } from "vitest";
import { aiCapability, isLocalEndpoint } from "./capability";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "./settings";

const settings = (overrides: Partial<AiSettings> = {}): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  ...overrides,
});

describe("aiCapability", () => {
  it("is configured for a remote provider with a stored key", () => {
    expect(aiCapability({ aiSettings: settings(), keyPresent: true })).toEqual({
      configured: true,
      reasons: [],
    });
  });

  it("reports a missing key for a remote provider", () => {
    const result = aiCapability({ aiSettings: settings(), keyPresent: false });
    expect(result.configured).toBe(false);
    expect(result.reasons).toEqual(["no API key stored"]);
  });

  it("fails closed when the key status is unknown (null)", () => {
    const result = aiCapability({ aiSettings: settings(), keyPresent: null });
    expect(result.configured).toBe(false);
    expect(result.reasons).toEqual(["no API key stored"]);
  });

  it("reports a missing model", () => {
    const result = aiCapability({ aiSettings: settings({ model: "   " }), keyPresent: true });
    expect(result.configured).toBe(false);
    expect(result.reasons).toEqual(["no model selected"]);
  });

  it("reports an endpoint that is not an allowed URL", () => {
    for (const baseUrl of ["", "   ", "not a url", "ftp://example.com/v1", "http://example.com/v1"]) {
      const result = aiCapability({ aiSettings: settings({ baseUrl }), keyPresent: true });
      expect(result.configured, `baseUrl=${JSON.stringify(baseUrl)}`).toBe(false);
      expect(result.reasons, `baseUrl=${JSON.stringify(baseUrl)}`).toEqual(["endpoint is not a URL"]);
    }
  });

  it("allows the Ollama preset without a key (local endpoint)", () => {
    const ollama: AiSettings = {
      ...DEFAULT_AI_SETTINGS,
      preset: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
    };
    expect(aiCapability({ aiSettings: ollama, keyPresent: false })).toEqual({
      configured: true,
      reasons: [],
    });
    // Unknown key status is fine locally — no key is ever sent there.
    expect(aiCapability({ aiSettings: ollama, keyPresent: null })).toEqual({
      configured: true,
      reasons: [],
    });
  });

  it("allows any loopback endpoint without a key (custom preset)", () => {
    const local = settings({ preset: "custom", baseUrl: "http://localhost:1234/v1", model: "m" });
    expect(aiCapability({ aiSettings: local, keyPresent: false })).toEqual({
      configured: true,
      reasons: [],
    });
  });

  it("accumulates every reason in a stable order", () => {
    const result = aiCapability({
      aiSettings: settings({ baseUrl: "junk", model: "" }),
      keyPresent: false,
    });
    expect(result.reasons).toEqual([
      "endpoint is not a URL",
      "no model selected",
      "no API key stored",
    ]);
  });

  it("isLocalEndpoint only trusts parseable loopback hosts", () => {
    expect(isLocalEndpoint("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalEndpoint("http://localhost:11434/v1")).toBe(true);
    expect(isLocalEndpoint("https://127.0.0.1:8443/v1")).toBe(true);
    expect(isLocalEndpoint("localhost:11434")).toBe(false); // not a URL
    expect(isLocalEndpoint("http://192.168.1.5:11434/v1")).toBe(false); // LAN, not loopback
    expect(isLocalEndpoint("")).toBe(false);
  });
});
