/**
 * M2 Wave C1 — AI settings model (pure logic; TDD red phase).
 * The critical invariant: serialization can never leak a secret — the
 * settings JSON carries exactly five known fields, nothing else.
 */
import { describe, expect, it } from "vitest";
import {
  COST_PREVIEW_INPUT_TOKENS,
  DEFAULT_AI_SETTINGS,
  applyPreset,
  costPreview,
  estimateCostUsd,
  isPresetId,
  isValidBaseUrl,
  parseAiSettings,
  serializeAiSettings,
  type AiSettings,
} from "./settings";

const KEYS = ["baseUrl", "model", "preset", "priceInputPerM", "priceOutputPerM"].sort();

describe("serializeAiSettings", () => {
  it("emits exactly the five known fields", () => {
    const out = serializeAiSettings(DEFAULT_AI_SETTINGS);
    expect(Object.keys(out).sort()).toEqual(KEYS);
  });

  it("NEVER serializes key material, even when the input object carries secret fields", () => {
    const rogue = {
      ...DEFAULT_AI_SETTINGS,
      apiKey: "sk-should-not-appear",
      key: "sk-should-not-appear",
      token: "sk-should-not-appear",
      password: "sk-should-not-appear",
    } as unknown as AiSettings;
    const json = JSON.stringify(serializeAiSettings(rogue));
    expect(json).not.toContain("sk-should-not-appear");
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("password");
    expect(Object.keys(serializeAiSettings(rogue)).sort()).toEqual(KEYS);
  });

  it("clamps non-finite or negative prices to 0 and unknown presets to custom", () => {
    const out = serializeAiSettings({
      preset: "nope" as AiSettings["preset"],
      baseUrl: "  https://api.openai.com/v1  ",
      model: "  gpt-4o-mini  ",
      priceInputPerM: Number.NaN,
      priceOutputPerM: -3,
    });
    expect(out.preset).toBe("custom");
    expect(out.priceInputPerM).toBe(0);
    expect(out.priceOutputPerM).toBe(0);
    expect(out.baseUrl).toBe("https://api.openai.com/v1");
    expect(out.model).toBe("gpt-4o-mini");
  });
});

describe("parseAiSettings", () => {
  it("round-trips a serialized record", () => {
    const settings: AiSettings = {
      preset: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
      priceInputPerM: 0,
      priceOutputPerM: 0,
    };
    expect(parseAiSettings(serializeAiSettings(settings))).toEqual(settings);
  });

  it("falls back to defaults for garbage input", () => {
    expect(parseAiSettings(null)).toEqual(DEFAULT_AI_SETTINGS);
    expect(parseAiSettings("nonsense")).toEqual(DEFAULT_AI_SETTINGS);
    expect(parseAiSettings(42)).toEqual(DEFAULT_AI_SETTINGS);
    expect(parseAiSettings({})).toEqual(DEFAULT_AI_SETTINGS);
  });

  it("drops unknown fields (a leaked key in the JSON cannot survive a load)", () => {
    const parsed = parseAiSettings({
      ...serializeAiSettings(DEFAULT_AI_SETTINGS),
      apiKey: "sk-leaked-in-file",
    });
    expect(Object.keys(parsed).sort()).toEqual(KEYS);
    expect(JSON.stringify(parsed)).not.toContain("sk-leaked-in-file");
  });

  it("fills baseUrl/model from the preset when they are missing", () => {
    const parsed = parseAiSettings({ preset: "ollama" });
    expect(parsed.preset).toBe("ollama");
    expect(parsed.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(parsed.model).toBe("llama3.2");
  });
});

describe("applyPreset", () => {
  it("fills baseUrl + first suggested model from the preset table", () => {
    const filled = applyPreset("openrouter");
    expect(filled.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(filled.model).toBe("openai/gpt-4o-mini");
  });

  it("clears baseUrl/model for custom (user supplies their own)", () => {
    expect(applyPreset("custom")).toEqual({ baseUrl: "", model: "" });
  });
});

describe("isValidBaseUrl", () => {
  it("accepts https anywhere and http only for loopback", () => {
    expect(isValidBaseUrl("https://api.openai.com/v1")).toBe(true);
    expect(isValidBaseUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isValidBaseUrl("http://localhost:11434/v1")).toBe(true);
  });

  it("rejects remote http, garbage and empty values", () => {
    expect(isValidBaseUrl("http://example.com/v1")).toBe(false);
    expect(isValidBaseUrl("not a url")).toBe(false);
    expect(isValidBaseUrl("")).toBe(false);
    expect(isValidBaseUrl("   ")).toBe(false);
  });
});

describe("cost math", () => {
  it("prices tokens linearly against the USD-per-1M table", () => {
    expect(estimateCostUsd(1_000_000, 3)).toBe(3);
    expect(estimateCostUsd(10_000, 2.5)).toBeCloseTo(0.025, 10);
    expect(estimateCostUsd(0, 2.5)).toBe(0);
    expect(estimateCostUsd(10_000, 0)).toBe(0);
  });

  it("treats non-finite inputs as free rather than NaN", () => {
    expect(estimateCostUsd(Number.NaN, 2.5)).toBe(0);
    expect(estimateCostUsd(10_000, Number.POSITIVE_INFINITY)).toBe(0);
    expect(estimateCostUsd(-5, 2.5)).toBe(0);
  });

  it("cost preview is a hypothetical 10k-token input at current prices", () => {
    const preview = costPreview({
      ...DEFAULT_AI_SETTINGS,
      priceInputPerM: 1,
    });
    expect(preview.inputTokens).toBe(COST_PREVIEW_INPUT_TOKENS);
    expect(preview.inputTokens).toBe(10_000);
    expect(preview.usd).toBeCloseTo(0.01, 10);
  });
});

describe("isPresetId", () => {
  it("accepts known preset ids and rejects everything else", () => {
    expect(isPresetId("openai")).toBe(true);
    expect(isPresetId("custom")).toBe(true);
    expect(isPresetId("sk-evil")).toBe(false);
    expect(isPresetId(undefined)).toBe(false);
    expect(isPresetId(7)).toBe(false);
  });
});
