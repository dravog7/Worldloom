import type { Note } from "../types";
import type { DerivedEdge } from "./edge";
import { isDerivedEdge } from "./edge";

/** Sidecar format version — bump on breaking payload changes. */
export const SIDECAR_VERSION = 1;

/** JSON sidecar shape: `{version: 1, vaultHash, notes, edges}` (PLAN-M1 B2). */
export interface IndexSidecar {
  version: number;
  vaultHash: string;
  notes: Note[];
  edges: DerivedEdge[];
}

export function serializeSidecar(sidecar: IndexSidecar): string {
  return JSON.stringify(sidecar);
}

function isNote(value: unknown): value is Note {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { title?: unknown }).title === "string"
  );
}

/**
 * Parses and validates a sidecar. Returns null on corrupt JSON, unsupported
 * version, or vaultHash mismatch — the caller (MemoryIndex.load) then keeps
 * its current state and reports false so the app rebuilds from the vault.
 */
export function deserializeSidecar(
  text: string,
  expectedVaultHash: string,
): IndexSidecar | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.version !== SIDECAR_VERSION) return null;
  if (typeof raw.vaultHash !== "string" || raw.vaultHash !== expectedVaultHash) {
    return null;
  }
  const { notes, edges } = raw;
  if (!Array.isArray(notes) || !notes.every(isNote)) return null;
  if (edges !== undefined && (!Array.isArray(edges) || !edges.every(isDerivedEdge))) {
    return null;
  }
  return {
    version: SIDECAR_VERSION,
    vaultHash: raw.vaultHash,
    notes,
    edges: Array.isArray(edges) ? edges : [],
  };
}
