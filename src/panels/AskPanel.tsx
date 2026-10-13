import {
  useState,
  type FormEvent,
  type JSX,
  type MouseEvent,
} from "react";
import type { ChatMessage, Transport } from "../core/ai/types";
import { renderAnswer, type AskCitation } from "../core/ask/answer";
import type { IndexProvider } from "../core/index/provider";
import { MAX_HISTORY_MESSAGES, runAskTurn } from "./ask";
import "./ask.css";

/**
 * Ask panel (PLAN-M2 E2) — chat over the vault with cited answers.
 *
 * Thin view over runAskTurn (./ask.ts holds the testable flow): retrieval +
 * honesty floor + frozen ask-v1 prompt + per-kind error copy all live there.
 * This component owns only in-memory chat state (never persisted — chat is
 * ephemeral by design), the composer, the citation strip, and the click
 * delegation that turns `a[data-path]` anchors into onOpenNote jumps.
 */
export interface AskPanelProps {
  index: IndexProvider;
  transport: Transport;
  /** false ⇒ composer disabled + setup CTA (PRD-M2 §4 gating). */
  aiConfigured: boolean;
  /** Note currently open — its backlinks and body seed the context. */
  openNotePath?: string;
  /** Endpoint for ChatRequest; the Rust proxy reads the key itself. */
  baseUrl?: string;
  model?: string;
  /** Open a cited note, optionally at a line. */
  onOpenNote(path: string, line?: number): void;
  /** Setup CTA target (the AI settings modal). */
  onOpenSettings?(): void;
}

interface AskLogEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** Assistant answers only: sanitized linkified HTML. */
  html?: string;
  citations?: AskCitation[];
  suggestions?: string[];
  isError?: boolean;
}

const EMPTY_HINT = "Ask anything about your world — answers cite the notes they come from.";

/** Rebuilds the wire-shape history from the log (errors never replay). */
function toHistory(entries: readonly AskLogEntry[]): ChatMessage[] {
  return entries
    .filter((entry) => !entry.isError)
    .map((entry) => ({ role: entry.role, content: entry.text }))
    .slice(-MAX_HISTORY_MESSAGES);
}

/** Unique citation chips, first occurrence wins. */
function chipKeys(citations: readonly AskCitation[]): AskCitation[] {
  const seen = new Set<string>();
  const chips: AskCitation[] = [];
  for (const citation of citations) {
    const key = citation.line === undefined ? citation.path : `${citation.path}:${citation.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push(citation);
  }
  return chips;
}

export function AskPanel(props: AskPanelProps): JSX.Element {
  const [entries, setEntries] = useState<AskLogEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [nextId, setNextId] = useState(1);

  const push = (entry: Omit<AskLogEntry, "id">): void => {
    setEntries((previous) => [...previous, { ...entry, id: nextId }]);
    setNextId((id) => id + 1);
  };

  const send = async (rawQuestion: string): Promise<void> => {
    const question = rawQuestion.trim();
    if (question === "" || busy || !props.aiConfigured) return;
    setInput("");
    setBusy(true);
    const history = toHistory(entries);
    push({ role: "user", text: question });
    const result = await runAskTurn(question, {
      index: props.index,
      transport: props.transport,
      endpoint: { baseUrl: props.baseUrl ?? "", model: props.model ?? "" },
      openNotePath: props.openNotePath,
      history,
    });
    switch (result.kind) {
      case "not-found":
        push({ role: "assistant", text: result.reply, suggestions: result.suggestions });
        break;
      case "answer": {
        const knownPaths = props.index.all().map((note) => note.path);
        push({
          role: "assistant",
          text: result.reply,
          html: renderAnswer(result.reply, knownPaths),
          citations: result.citations,
        });
        break;
      }
      case "error":
        push({ role: "assistant", text: result.message, isError: true });
        break;
    }
    setBusy(false);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void send(input);
  };

  // Citation anchors are data-carriers only; navigation is click-delegated.
  const onAssistantClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[data-path]");
    if (anchor === null) {
      event.preventDefault();
      return;
    }
    const path = anchor.getAttribute("data-path");
    if (!path) return;
    event.preventDefault();
    const line = anchor.getAttribute("data-line");
    props.onOpenNote(
      path,
      line !== null && /^\d+$/.test(line) ? Number(line) : undefined,
    );
  };

  return (
    <section className="wl-panel wl-ask" aria-label="Ask">
      <header className="wl-panel-header">ask</header>
      <div className="wl-ask-log" role="log" aria-live="polite">
        {entries.length === 0 && <p className="wl-empty">{EMPTY_HINT}</p>}
        {entries.map((entry) =>
          entry.role === "user" ? (
            <div key={entry.id} className="wl-ask-turn wl-ask-user">
              {entry.text}
            </div>
          ) : entry.isError ? (
            <p key={entry.id} className="wl-ask-error" role="alert">
              {entry.text}
            </p>
          ) : (
            <div key={entry.id} className="wl-ask-turn wl-ask-assistant">
              <div
                className="wl-ask-answer"
                onClick={onAssistantClick}
                dangerouslySetInnerHTML={{ __html: entry.html ?? entry.text }}
              />
              {entry.citations && entry.citations.length > 0 && (
                <div className="wl-ask-citations" aria-label="Cited notes">
                  {chipKeys(entry.citations).map((citation) => (
                    <button
                      key={`${citation.path}:${citation.line ?? -1}`}
                      type="button"
                      className="wl-cite-chip"
                      title={citation.path}
                      onClick={() => props.onOpenNote(citation.path, citation.line)}
                    >
                      {citation.path}
                      {citation.line !== undefined ? `:${citation.line}` : ""}
                    </button>
                  ))}
                </div>
              )}
              {entry.suggestions && entry.suggestions.length > 0 && (
                <div className="wl-ask-suggestions" aria-label="Did you mean">
                  {entry.suggestions.map((title) => (
                    <button
                      key={title}
                      type="button"
                      className="wl-cite-chip wl-suggest-chip"
                      onClick={() => setInput(title)}
                    >
                      {title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {busy && (
          <div className="wl-ask-turn wl-ask-loading" aria-busy="true">
            Asking…
          </div>
        )}
      </div>
      {!props.aiConfigured ? (
        <p className="wl-ask-setup">
          AI isn't set up yet — add a provider to ask your world.{" "}
          <button type="button" className="wl-btn" onClick={() => props.onOpenSettings?.()}>
            Set up AI
          </button>
        </p>
      ) : (
        <form className="wl-ask-composer" onSubmit={onSubmit}>
          <input
            className="wl-filter wl-ask-input"
            type="text"
            value={input}
            placeholder="Ask your world…"
            aria-label="Question"
            onChange={(event) => setInput(event.target.value)}
          />
          <button type="submit" className="wl-btn" disabled={busy || input.trim() === ""}>
            {busy ? "Asking…" : "Ask"}
          </button>
        </form>
      )}
    </section>
  );
}
