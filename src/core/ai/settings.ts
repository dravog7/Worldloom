/**
 * M2 Wave C1 — AI settings model (PLAN-M2 §C1, PRD-M2 §1).
 *
 * Pure, Tauri-free, secret-free. The ONE invariant this module exists to
 * enforce: the persisted settings JSON carries exactly five known fields —
 * `preset`, `baseUrl`, `model`, `priceInputPerM`, `priceOutputPerM` — and
 * nothing else. The API key lives in the OS keyring (Wave A1) and never
 * appears in the store, this module, or any file the app writes (ADR-006 §2).
 */
import { PROVIDER_PRESETS, assertEndpointAllowed, type PresetId } from "./client";

export interface AiSettings {
  preset: PresetId;
  /** OpenAI-compatible base URL. Empty for `custom` until supplied. */
  baseUrl: string;
  model: string;
  /** USD per 1M input tokens (user-editable cost table). */
  priceInputPerM: number;
  /** USD per 1M output tokens. */
  priceOutputPerM: number;
}

/** Neutral default: OpenAI preset endpoints, prices unset (user fills in). */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  preset: "openai",
  baseUrl: PROVIDER_PRESETS.openai.baseUrl,
  model: PROVIDER_PRESETS.openai.models[0] ?? "",
  priceInputPerM: 0,
  priceOutputPerM: 0,
};

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && value in PROVIDER_PRESETS;
}

/** Preset → the two fields a preset knows: baseUrl + suggested first model. */
export function applyPreset(id: PresetId): Pick<AiSettings, "baseUrl" | "model"> {
  const preset = PROVIDER_PRESETS[id] ?? PROVIDER_PRESETS.custom;
  return { baseUrl: preset.baseUrl, model: preset.models[0] ?? "" };
}

/**
 * Client-side base-URL gate (mirrors ADR-006 §3 / client.ts validation):
 * https everywhere, http only for loopback (Ollama).
 */
export function isValidBaseUrl(url: string): boolean {
  if (!url.trim()) return false;
  try {
    assertEndpointAllowed(url.trim());
    return true;
  } catch {
    return false;
  }
}

/** Linear cost math: tokens / 1M × USD-per-1M. Garbage prices read as free. */
export function estimateCostUsd(tokens: number, usdPerM: number): number {
  if (!Number.isFinite(tokens) || tokens < 0) return 0;
  if (!Number.isFinite(usdPerM) || usdPerM < 0) return 0;
  return (tokens / 1_000_000) * usdPerM;
}

/** Hypothetical 10k-token input shown in the settings cost preview. */
export const COST_PREVIEW_INPUT_TOKENS = 10_000;

export function costPreview(settings: AiSettings): { inputTokens: number; usd: number } {
  return {
    inputTokens: COST_PREVIEW_INPUT_TOKENS,
    usd: estimateCostUsd(COST_PREVIEW_INPUT_TOKENS, settings.priceInputPerM),
  };
}

const money = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

/**
 * Persisted shape — field-by-field pick, NEVER a spread, so an accidental
 * extra property (a pasted key, a token) cannot reach disk. Keys are fixed:
 * adding a field here is a deliberate, reviewed act.
 */
export function serializeAiSettings(settings: AiSettings): Record<string, string | number> {
  return {
    preset: isPresetId(settings.preset) ? settings.preset : "custom",
    baseUrl: typeof settings.baseUrl === "string" ? settings.baseUrl.trim() : "",
    model: typeof settings.model === "string" ? settings.model.trim() : "",
    priceInputPerM: money(settings.priceInputPerM),
    priceOutputPerM: money(settings.priceOutputPerM),
  };
}

/**
 * Tolerant loader for the settings file: reconstructs field-by-field, so
 * unknown/degraded stored data (or a leaked secret someone hand-added)
 * never survives a load. Missing baseUrl/model fall back to the preset.
 */
export function parseAiSettings(raw: unknown): AiSettings {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const preset = isPresetId(record.preset) ? record.preset : DEFAULT_AI_SETTINGS.preset;
  const fallback = applyPreset(preset);
  return {
    preset,
    baseUrl:
      typeof record.baseUrl === "string" && record.baseUrl.trim()
        ? record.baseUrl.trim()
        : fallback.baseUrl,
    model:
      typeof record.model === "string" && record.model.trim() ? record.model.trim() : fallback.model,
    priceInputPerM: money(record.priceInputPerM),
    priceOutputPerM: money(record.priceOutputPerM),
  };
}
