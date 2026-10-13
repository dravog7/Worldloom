/**
 * M2 I1 — AuditStatePort (src/core/audit/llm.ts) backed by app-data via the
 * Tauri store plugin. Tombstone state is disposable derived data and MUST
 * never live in the vault (ADR-002: vault = markdown only).
 */
import { Store } from "@tauri-apps/plugin-store";
import type { AuditStatePort } from "../../core/audit/llm";

const AUDIT_FILE = "worldloom-audit-state.json";
const AUDIT_KEY = "auditState";

export function tauriAuditStatePort(): AuditStatePort {
  return {
    async read(): Promise<string | null> {
      try {
        const store = await Store.load(AUDIT_FILE);
        return (await store.get<string>(AUDIT_KEY)) ?? null;
      } catch {
        return null;
      }
    },
    async write(serialized: string): Promise<void> {
      const store = await Store.load(AUDIT_FILE);
      await store.set(AUDIT_KEY, serialized);
      await store.save();
    },
  };
}
