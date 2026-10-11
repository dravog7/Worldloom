/**
 * Vault service (PLAN-M1 B3): recursive scan, debounced change handling with
 * self-write suppression, atomic saves (FsPort contract), stub-note creation.
 * All dependencies (fs, parser, index, timer) are injected — see ARCH.md.
 */
export { VaultNotOpenError, VaultService, VAULT_DEBOUNCE_MS } from "./vault-service";
export type { ChangeKind, ParseNoteFn, VaultServiceDeps } from "./vault-service";
export { contentHash } from "./hash";
export { generateStubNote, slugifyFileName } from "./stub";
export { systemTimer, ManualTimer } from "./timer";
export type { TimerPort } from "./timer";
export type { DirEntry, FsPort } from "./fs-port";
