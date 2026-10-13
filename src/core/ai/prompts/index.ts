import { askV1 } from "./ask-v1";
import { auditV1 } from "./audit-v1";
import { extractionV1 } from "./extraction-v1";
import type { PromptDefinition } from "./types";

export { askV1, auditV1, extractionV1 };
export type { AskContextItem, AskInput } from "./ask-v1";
export type { AuditInput, AuditNoteInput } from "./audit-v1";
export type { ExtractionInput } from "./extraction-v1";
export { definePrompt, toChatMessages } from "./types";
export type { PromptDefinition } from "./types";

/**
 * Versioned prompt suite (PLAN-M2 B2).
 *
 * Every shipped prompt version is frozen data. Adding a prompt version means
 * appending here — never editing an existing entry's `system`/`user` text.
 */
const REGISTRY: ReadonlyArray<PromptDefinition<unknown>> = [
  extractionV1,
  auditV1,
  askV1,
];

/** All registered prompt ids, in registration order. */
export const promptIds: readonly string[] = REGISTRY.map(
  (prompt) => prompt.id,
);

/** Resolves a prompt by exact (id, version); unknown ids/versions → undefined. */
export function getPrompt(
  id: string,
  version: number,
): PromptDefinition<unknown> | undefined {
  return REGISTRY.find(
    (prompt) => prompt.id === id && prompt.version === version,
  );
}

/** Highest registered version for an id, or undefined if the id is unknown. */
export function latestVersion(id: string): number | undefined {
  const versions = REGISTRY.filter((prompt) => prompt.id === id).map(
    (prompt) => prompt.version,
  );
  return versions.length === 0 ? undefined : Math.max(...versions);
}
