import type { ChatMessage } from "../types";

/**
 * One entry of the versioned prompt suite (PLAN-M2 B2).
 *
 * Prompts are versioned DATA: once shipped, a version's text is frozen —
 * changes ship as a new version so recorded runs stay reproducible.
 */
export interface PromptDefinition<I> {
  /** Stable prompt identifier, e.g. "extraction". */
  id: string;
  /** Monotonic version, starting at 1. */
  version: number;
  /** Human-readable purpose, shown in docs/debug tooling. */
  description: string;
  /** System-turn text (static). */
  system: string;
  /** Builds the user turn from typed input. */
  user(input: I): string;
}

/** Identity helper for prompt data modules; keeps `as const` field types. */
export function definePrompt<I>(prompt: PromptDefinition<I>): PromptDefinition<I> {
  return prompt;
}

/**
 * Wire-shapes a prompt into an OpenAI-compatible message pair.
 *
 * `input` interpolates UNTRUSTED vault content into the user turn only —
 * see the prompt-injection note in ./index.ts; the system turn is static
 * frozen data and never carries vault text.
 */
export function toChatMessages<I>(
  prompt: PromptDefinition<I>,
  input: I,
): ChatMessage[] {
  return [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user(input) },
  ];
}
