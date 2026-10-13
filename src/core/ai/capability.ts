/**
 * M2 Wave C2 — pure AI capability gate (PLAN-M2 §C2, PRD-M2 §5).
 *
 * Answers one question with zero side effects: is an AI surface allowed to
 * run? `configured` is true only when the endpoint is an allowed URL, a model
 * is selected, and — for remote providers — a key is present in the OS
 * keyring. Local (loopback) endpoints never need a key, so Ollama works
 * offline and credential-free.
 *
 * This is the single choke point every AI surface must consult BEFORE any
 * `ai_chat` invocation (ADR-006): unconfigured degrades to the setup CTA in
 * <AiGate>, never to a network call. Pure TypeScript — no Tauri, no network,
 * no store (ARCH.md purity guard).
 */
import { isValidBaseUrl, type AiSettings } from "./settings";

/** Human-readable blockers, in a stable order, shown in the setup CTA. */
export const AI_CAPABILITY_REASONS = {
  badEndpoint: "endpoint is not a URL",
  noModel: "no model selected",
  noKey: "no API key stored",
} as const;

export interface AiCapabilityInput {
  aiSettings: AiSettings;
  /** `null` = keyring status unknown (not fetched / non-Tauri dev). */
  keyPresent: boolean | null;
}

export interface AiCapability {
  /** True only when every requirement is met — safe to invoke `ai_chat`. */
  configured: boolean;
  /** Every unmet requirement; empty exactly when `configured` is true. */
  reasons: string[];
}

/** Loopback hosts that ADR-006 §3 exempts from https and from keying. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * True iff the base URL is parseable and points at this machine. A key is
 * never required for these (Ollama, a self-hosted proxy) — nothing leaves
 * the box. Anything unparseable is NOT local, so it fails closed.
 */
export function isLocalEndpoint(baseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(baseUrl.trim()).hostname);
  } catch {
    return false;
  }
}

/**
 * The gate. `reasons` is exhaustive — it lists every unmet requirement, not
 * just the first, so the CTA can tell the user everything at once.
 *
 * Key handling is deliberately one-sided: `keyPresent === true` passes; both
 * `false` and `null` block a remote endpoint. Unknown is not permission.
 */
export function aiCapability(input: AiCapabilityInput): AiCapability {
  const { aiSettings, keyPresent } = input;
  const reasons: string[] = [];

  if (!isValidBaseUrl(aiSettings.baseUrl)) reasons.push(AI_CAPABILITY_REASONS.badEndpoint);
  if (!aiSettings.model.trim()) reasons.push(AI_CAPABILITY_REASONS.noModel);

  const requiresKey = !isLocalEndpoint(aiSettings.baseUrl);
  if (requiresKey && keyPresent !== true) reasons.push(AI_CAPABILITY_REASONS.noKey);

  return { configured: reasons.length === 0, reasons };
}
