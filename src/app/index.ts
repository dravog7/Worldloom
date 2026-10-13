/**
 * zustand store + Tauri adapters (fs/dialog/watcher/store → core events).
 * The only layer allowed to import @tauri-apps/* (ARCH.md).
 * Store wiring lands in I1; B3 ships the adapters.
 */
export { TauriFsAdapter } from "./adapters/tauri-fs";
export { NodeFsAdapter } from "./adapters/node-fs";
export { pickVaultFolder } from "./adapters/folder-dialog";
export { loadVaultPath, saveVaultPath, VAULT_PATH_KEY } from "./adapters/vault-path";
/** M2 Wave C2 — AI capability gate (wrap AI surfaces; CTA when unconfigured). */
export { AiGate, useAiCapability, type AiGateProps } from "./AiGate";
export { aiCapability, isLocalEndpoint, type AiCapability } from "../core/ai/capability";
