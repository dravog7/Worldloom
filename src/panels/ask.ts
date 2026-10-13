/**
 * M2 Wave E2 — Ask turn orchestration (PLAN-M2 E2).
 *
 * Pure logic behind the Ask panel, kept out of the .tsx so it is testable in
 * the node test environment (the repo convention: thin components, logic in
 * .ts — see search.ts / backlinks.ts).
 *
 * One `runAskTurn` = retrieval → honesty floor → frozen ask-v1 prompt →
 * transport → citations. The honesty rule (PRD-M2 §4) is enforced in code:
 * when retrieval comes back empty the transport is NEVER called and the
 * local "not in your world" answer is returned (with fuzzy title
 * suggestions from the index, when any). Chat history is in-memory caller
 * state; it threads between the system turn and the context turn so the
 * retrieved context always stays adjacent to the question it answers.
 */
import { AiClient } from "../core/ai/client";
import { askV1, toChatMessages } from "../core/ai/prompts";
import { AiError, type ChatMessage, type Transport } from "../core/ai/types";
import { buildAskContextItems } from "../core/ask/context";
import { extractCitations, type AskCitation } from "../core/ask/answer";
import type { IndexProvider } from "../core/index/provider";

/** The local honesty answer — never invented, never deferred to the model. */
export const NOT_IN_WORLD_REPLY = "That isn't in your world yet.";

/** Cap on carried history turns (user+assistant counted individually). */
export const MAX_HISTORY_MESSAGES = 12;

/** Endpoint the request targets; the Rust proxy re-reads the key itself. */
export interface AskEndpoint {
  baseUrl: string;
  model: string;
}

export type AskTurnResult =
  | { kind: "not-found"; reply: string; suggestions: string[] }
  | { kind: "answer"; reply: string; citations: AskCitation[]; sources: string[] }
  | { kind: "error"; message: string };

export interface AskTurnOptions {
  index: IndexProvider;
  transport: Transport;
  endpoint: AskEndpoint;
  openNotePath?: string;
  /** Prior turns, user/assistant interleaved; newest last. */
  history?: readonly ChatMessage[];
}

/**
 * Maps the typed AI failure taxonomy (ai/types.ts) to user-facing copy.
 * Raw error messages never reach the UI — they can carry endpoint details
 * and internals the user shouldn't see in a chat bubble.
 */
export function friendlyAiError(err: unknown): string {
  if (err instanceof AiError) {
    switch (err.kind) {
      case "auth":
        return "Key rejected — check Settings.";
      case "no-key":
        return "No API key is stored — add one in Settings.";
      case "network":
        return "Couldn't reach your AI endpoint.";
      case "timeout":
        return "Your AI endpoint timed out — try again.";
      case "http":
        return `Your AI endpoint returned an error${err.status !== undefined ? ` (${err.status})` : ""}.`;
      case "invalid-response":
        return "Your AI endpoint replied with something unreadable.";
      case "invalid-endpoint":
        return "That AI endpoint isn't allowed — https only (http for localhost).";
    }
  }
  return "Something went wrong while asking your world.";
}

/** Top-3 fuzzy title matches for the not-found suggestions chips. */
function suggestionsFor(index: IndexProvider, question: string): string[] {
  return index
    .byTitleOrAlias(question)
    .slice(0, 3)
    .map((note) => note.title);
}

/** Runs one ask turn. Never throws — failures come back typed. */
export async function runAskTurn(
  question: string,
  options: AskTurnOptions,
): Promise<AskTurnResult> {
  const { index, transport, endpoint, openNotePath } = options;

  // Retrieval. Empty ⇒ honesty floor: local answer, no model round-trip.
  const context = buildAskContextItems(index, question, openNotePath);
  if (context.length === 0) {
    return {
      kind: "not-found",
      reply: NOT_IN_WORLD_REPLY,
      suggestions: suggestionsFor(index, question),
    };
  }

  // Frozen ask-v1 prompt; history threads between system and context turn.
  const [systemTurn, contextTurn] = toChatMessages(askV1, { question, context });
  const history = (options.history ?? []).filter(
    (message) => message.role !== "system",
  );
  const messages: ChatMessage[] = [
    systemTurn,
    ...history.slice(-MAX_HISTORY_MESSAGES),
    contextTurn,
  ];

  try {
    const client = new AiClient(transport);
    const response = await client.chat({
      baseUrl: endpoint.baseUrl,
      model: endpoint.model,
      messages,
    });
    const knownPaths = index.all().map((note) => note.path);
    return {
      kind: "answer",
      reply: response.content,
      citations: extractCitations(response.content, knownPaths),
      sources: context.map((item) => item.path),
    };
  } catch (err) {
    return { kind: "error", message: friendlyAiError(err) };
  }
}
