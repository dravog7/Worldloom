/**
 * AI transport contract (ADR-006 §4, M2 Wave B1).
 *
 * The frozen shapes live in ./types.ts (owned by the orchestrator). This module
 * is the single import surface for the injected `Transport` seam: the Tauri
 * adapter (`src/app/adapters/ai-tauri.ts`) implements it via
 * `invoke('ai_chat')`, and unit tests implement it with in-memory mocks.
 * src/core never touches the network itself and never imports Tauri.
 */
export type {
  AiErrorKind,
  AiResponse,
  ChatMessage,
  ChatRequest,
  TokenUsage,
  Transport,
} from "./types";
export { AiError } from "./types";
