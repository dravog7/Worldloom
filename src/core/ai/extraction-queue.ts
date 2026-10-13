/**
 * M2 Wave E1 — per-note extraction queue (PLAN-M2 §E1).
 *
 * Pure orchestration over the injected `Transport` (ADR-006 §4): one note at
 * a time, a 2-notes/second start cap (configurable), pause/resume/cancel, and
 * typed outcomes. Zero network, zero Tauri, zero timers of its own — the
 * clock is injectable, so tests are deterministic under a fake clock and the
 * rate cap is asserted as exact start timestamps.
 *
 * Request building reuses B1 (`buildChatRequest` + `AiClient` retry on
 * 429/5xx, whose backoff also honours the injected clock) and parsing reuses
 * B2 (`buildExtractionMessages` + `extractProposals`, so proposals arrive
 * deduped against the note's existing frontmatter).
 */
import { AiClient, buildChatRequest } from "./client";
import {
  buildExtractionMessages,
  extractProposals,
  type ExtractionProposal,
} from "./extract";
import type { Relation } from "../types";
import type { Transport } from "./transport";

/** Minimal note view the extraction queue needs (superset of B2 input). */
export interface QueueNoteInput {
  /** Vault-relative path. */
  path: string;
  title: string;
  /** Markdown body without frontmatter — untrusted prompt data. */
  body: string;
  /** Existing frontmatter fields, used to dedupe proposals (B2). */
  type?: string;
  aliases?: string[];
  relations?: Relation[];
}

/** Per-note result: validated proposals or a typed/transport error. Never a throw. */
export type ExtractionOutcome =
  | { ok: true; proposals: ExtractionProposal[]; droppedDuplicates: number }
  | { ok: false; error: Error };

/** Injectable time source — the queue owns no timers (deterministic tests). */
export interface ExtractionClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: ExtractionClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Default start rate: 2 notes/second (PLAN-M2 §E1). */
export const DEFAULT_EXTRACTION_RATE_PER_SECOND = 2;

export interface ExtractionQueueOptions {
  /** Injected transport — tests pass a mock, the app passes the Tauri adapter. */
  transport: Transport;
  /** OpenAI-compatible endpoint for ChatRequest. No secrets, ever (keyring). */
  endpoint: { baseUrl: string; model: string };
  /** Notes started per second (default 2). */
  ratePerSecond?: number;
  /** Injected clock (default: system timers). */
  clock?: ExtractionClock;
  /** Response size cap forwarded to the B2 parser. */
  maxChars?: number;
  /** Fired per completed note (ok or error) — before onProgress. */
  onResult?: (note: QueueNoteInput, outcome: ExtractionOutcome) => void;
  /** Fired after each note with cumulative (done, total). */
  onProgress?: (done: number, total: number) => void;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * FIFO queue with concurrency 1 and a start-rate cap. `enqueue` is
 * fire-and-forget; completion is observed through onResult/onProgress or
 * `await waitIdle()`. `cancel()` drops pending work AND suppresses the
 * in-flight note's result (the queue stays reusable afterwards).
 */
export class ExtractionQueue {
  private readonly client: AiClient;
  private readonly endpoint: { baseUrl: string; model: string };
  private readonly clock: ExtractionClock;
  private readonly intervalMs: number;
  private readonly maxChars?: number;
  private readonly onResult?: ExtractionQueueOptions["onResult"];
  private readonly onProgress?: ExtractionQueueOptions["onProgress"];

  private readonly pending: QueueNoteInput[] = [];
  /** Bumped on cancel; work tagged with an older generation is discarded. */
  private generation = 0;
  private pausedFlag = false;
  private pumping = false;
  /** Virtual timestamp of the last note START (rate-cap anchor). */
  private startedAt = Number.NEGATIVE_INFINITY;
  private done = 0;
  private total = 0;
  private pumpDone: Promise<void> = Promise.resolve();

  constructor(options: ExtractionQueueOptions) {
    this.clock = options.clock ?? systemClock;
    // Retry backoff sleeps on the injected clock too — no real timers in tests.
    this.client = new AiClient(options.transport, {
      sleep: (ms: number) => this.clock.sleep(ms),
    });
    this.endpoint = options.endpoint;
    const rate = options.ratePerSecond ?? DEFAULT_EXTRACTION_RATE_PER_SECOND;
    this.intervalMs = rate > 0 ? 1000 / rate : 0;
    this.maxChars = options.maxChars;
    this.onResult = options.onResult;
    this.onProgress = options.onProgress;
  }

  /** Notes waiting to start (excludes the in-flight one). */
  get pendingCount(): number {
    return this.pending.length;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  /** True while a note is being extracted. */
  get running(): boolean {
    return this.pumping;
  }

  /**
   * Adds notes to the back of the queue (or the front with `priority`).
   * Safe to call while running; starts the pump if it is idle.
   */
  enqueue(
    notes: QueueNoteInput | readonly QueueNoteInput[],
    options: { priority?: boolean } = {},
  ): void {
    const list = Array.isArray(notes) ? notes : [notes as QueueNoteInput];
    if (list.length === 0) return;
    if (options.priority) this.pending.unshift(...list);
    else this.pending.push(...list);
    this.total += list.length;
    this.startPump();
  }

  /** Stops starting new notes; the in-flight note still completes and reports. */
  pause(): void {
    this.pausedFlag = true;
  }

  /** Continues after pause(). */
  resume(): void {
    this.pausedFlag = false;
    this.startPump();
  }

  /**
   * Drops all pending notes and suppresses the in-flight note's result.
   * Progress counters stay consistent (dropped notes never count as done).
   */
  cancel(): void {
    this.generation += 1;
    this.total -= this.pending.length;
    this.pending.length = 0;
  }

  /**
   * Resolves when nothing is in flight (queue drained, paused, or cancelled).
   * Callers enqueue first, then await this.
   */
  async waitIdle(): Promise<void> {
    while (this.pumping) {
      await this.pumpDone;
    }
  }

  private startPump(): void {
    if (this.pumping || this.pausedFlag || this.pending.length === 0) return;
    this.pumping = true;
    const generation = this.generation;
    this.pumpDone = this.drain(generation).finally(() => {
      this.pumping = false;
    });
  }

  private async drain(generation: number): Promise<void> {
    try {
      while (
        this.pending.length > 0 &&
        !this.pausedFlag &&
        this.generation === generation
      ) {
        const note = this.pending.shift() as QueueNoteInput;
        await this.awaitTurn();
        if (this.generation !== generation) {
          // Cancelled while waiting for the rate-limit slot.
          this.total -= 1;
          break;
        }
        this.startedAt = this.clock.now();
        await this.runOne(note, generation);
      }
    } catch {
      // Defensive: runOne reports its own failures; a broken clock must not
      // wedge the pump into an unhandled rejection.
    }
  }

  /** Enforces the start-rate cap: at most `intervalMs` between note starts. */
  private async awaitTurn(): Promise<void> {
    const wait = this.startedAt + this.intervalMs - this.clock.now();
    if (wait > 0) await this.clock.sleep(wait);
  }

  private async runOne(note: QueueNoteInput, generation: number): Promise<void> {
    let outcome: ExtractionOutcome;
    try {
      const request = buildChatRequest({
        baseUrl: this.endpoint.baseUrl,
        model: this.endpoint.model,
        messages: buildExtractionMessages({
          path: note.path,
          title: note.title,
          body: note.body,
          type: note.type,
        }),
      });
      const response = await this.client.chat(request);
      const parsed = extractProposals(
        {
          title: note.title,
          type: note.type,
          aliases: note.aliases ?? [],
          relations: note.relations ?? [],
        },
        response.content,
        this.maxChars === undefined ? {} : { maxChars: this.maxChars },
      );
      outcome = parsed.ok
        ? {
            ok: true,
            proposals: parsed.proposals,
            droppedDuplicates: parsed.droppedDuplicates,
          }
        : { ok: false, error: parsed.error };
    } catch (error) {
      outcome = { ok: false, error: toError(error) };
    }
    if (this.generation !== generation) {
      // Cancelled mid-flight: the result is discarded, the count stays true.
      this.total -= 1;
      return;
    }
    this.done += 1;
    this.onResult?.(note, outcome);
    this.onProgress?.(this.done, this.total);
  }
}
