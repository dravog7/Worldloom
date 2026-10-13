import { describe, expect, it } from "vitest";
import { AiError, type AiResponse, type ChatRequest, type Transport } from "./transport";
import { ExtractionParseError } from "./extract";
import {
  ExtractionQueue,
  type ExtractionClock,
  type ExtractionOutcome,
  type QueueNoteInput,
} from "./extraction-queue";

/**
 * M2 Wave E1 — extraction queue tests (PLAN-M2 §E1).
 *
 * Zero network: every request hits a scripted Transport. Time is fully
 * injected (ManualClock), so the 2-notes/sec cap is asserted as exact start
 * timestamps, never by waiting on wall-clock.
 */

/** Virtual clock: `sleep` advances virtual time and resolves immediately. */
class ManualClock implements ExtractionClock {
  t = 0;
  now(): number {
    return this.t;
  }
  sleep(ms: number): Promise<void> {
    this.t += Math.max(0, ms);
    return Promise.resolve();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

interface Recorded {
  req: ChatRequest;
  at: number;
}

class ScriptedTransport implements Transport {
  readonly calls: Recorded[] = [];
  private readonly script: (() => Promise<AiResponse>)[];

  constructor(
    private readonly clock: ExtractionClock,
    script: (() => Promise<AiResponse>)[],
  ) {
    this.script = [...script];
  }

  async chat(req: ChatRequest): Promise<AiResponse> {
    this.calls.push({ req, at: this.clock.now() });
    const next = this.script.shift();
    if (!next) throw new Error("ScriptedTransport: no scripted response left");
    return next();
  }
}

function proposalsResponse(json: string): () => Promise<AiResponse> {
  return () => Promise.resolve({ content: json, latencyMs: 1 });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the all-instant promise chain (pump loop) drain to a macrotask. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const NOTE_A: QueueNoteInput = { path: "a.md", title: "A", body: "A body mentions Aldric." };
const NOTE_B: QueueNoteInput = { path: "b.md", title: "B", body: "B body mentions Brina." };
const NOTE_C: QueueNoteInput = { path: "c.md", title: "C", body: "C body mentions Corrin." };

const ENDPOINT = { baseUrl: "https://api.example.com/v1", model: "test-model" };

interface Harness {
  queue: ExtractionQueue;
  clock: ManualClock;
  transport: ScriptedTransport;
  results: { note: QueueNoteInput; outcome: ExtractionOutcome }[];
  progress: [number, number][];
}

function makeHarness(
  script: (() => Promise<AiResponse>)[],
  options: { ratePerSecond?: number } = {},
): Harness {
  const clock = new ManualClock();
  const transport = new ScriptedTransport(clock, script);
  const results: Harness["results"] = [];
  const progress: [number, number][] = [];
  const queue = new ExtractionQueue({
    transport,
    endpoint: ENDPOINT,
    clock,
    ratePerSecond: options.ratePerSecond,
    onResult: (note, outcome) => results.push({ note, outcome }),
    onProgress: (done, total) => progress.push([done, total]),
  });
  return { queue, clock, transport, results, progress };
}

describe("ExtractionQueue — ordering & progress", () => {
  it("processes notes FIFO and reports monotonic progress", async () => {
    const { queue, results, progress } = makeHarness([
      proposalsResponse('{"proposals":[{"kind":"alias","alias":"Al","confidence":0.9}]}'),
      proposalsResponse('{"proposals":[]}'),
      proposalsResponse('{"proposals":[]}'),
    ]);
    queue.enqueue([NOTE_A, NOTE_B, NOTE_C]);
    await queue.waitIdle();
    expect(results.map((r) => r.note.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(results.every((r) => r.outcome.ok)).toBe(true);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("priority enqueue runs before lower-priority pending notes", async () => {
    const { queue, results } = makeHarness([
      proposalsResponse('{"proposals":[]}'),
      proposalsResponse('{"proposals":[]}'),
      proposalsResponse('{"proposals":[]}'),
    ]);
    queue.enqueue([NOTE_A, NOTE_B]);
    queue.enqueue(NOTE_C, { priority: true });
    await queue.waitIdle();
    expect(results.map((r) => r.note.path)).toEqual(["a.md", "c.md", "b.md"]);
  });

  it("enqueue of an empty list is a no-op", async () => {
    const { queue, transport, results } = makeHarness([]);
    queue.enqueue([]);
    await queue.waitIdle();
    expect(transport.calls).toHaveLength(0);
    expect(results).toHaveLength(0);
  });
});

describe("ExtractionQueue — rate cap (injectable clock)", () => {
  it("caps at 2 notes/sec: starts at 0, 500, 1000 ms", async () => {
    const { queue, transport } = makeHarness([
      proposalsResponse('{"proposals":[]}'),
      proposalsResponse('{"proposals":[]}'),
      proposalsResponse('{"proposals":[]}'),
    ]);
    queue.enqueue([NOTE_A, NOTE_B, NOTE_C]);
    await queue.waitIdle();
    expect(transport.calls.map((c) => c.at)).toEqual([0, 500, 1000]);
  });

  it("honours a configurable rate (10 notes/sec → 100 ms spacing)", async () => {
    const { queue, transport } = makeHarness(
      [
        proposalsResponse('{"proposals":[]}'),
        proposalsResponse('{"proposals":[]}'),
        proposalsResponse('{"proposals":[]}'),
      ],
      { ratePerSecond: 10 },
    );
    queue.enqueue([NOTE_A, NOTE_B, NOTE_C]);
    await queue.waitIdle();
    expect(transport.calls.map((c) => c.at)).toEqual([0, 100, 200]);
  });

  it("a slow note eats into the rate window (spacing measured from start, not completion)", async () => {
    const slow = deferred<AiResponse>();
    const { queue, clock, transport } = makeHarness([
      () => slow.promise,
      proposalsResponse('{"proposals":[]}'),
    ]);
    queue.enqueue([NOTE_A, NOTE_B]);
    await flush();
    expect(transport.calls).toHaveLength(1);
    // The model took 600 ms (> the 500 ms slot) — the next note starts at once.
    clock.advance(600);
    slow.resolve({ content: '{"proposals":[]}', latencyMs: 600 });
    await flush();
    expect(transport.calls.map((c) => c.at)).toEqual([0, 600]);
  });
});

describe("ExtractionQueue — concurrency 1", () => {
  it("starts the second request only after the first settles", async () => {
    const first = deferred<AiResponse>();
    const { queue, transport } = makeHarness([
      () => first.promise,
      proposalsResponse('{"proposals":[]}'),
    ]);
    queue.enqueue([NOTE_A, NOTE_B]);
    await flush();
    expect(transport.calls).toHaveLength(1);
    first.resolve({ content: '{"proposals":[]}', latencyMs: 1 });
    await flush();
    expect(transport.calls).toHaveLength(2);
  });
});

describe("ExtractionQueue — pause / resume", () => {
  it("pause lets the in-flight note finish but starts nothing new; resume continues", async () => {
    const first = deferred<AiResponse>();
    const second = deferred<AiResponse>();
    const { queue, transport, results } = makeHarness([
      () => first.promise,
      () => second.promise,
    ]);
    queue.enqueue([NOTE_A, NOTE_B]);
    await flush();
    queue.pause();
    expect(queue.paused).toBe(true);
    first.resolve({ content: '{"proposals":[]}', latencyMs: 1 });
    await flush();
    expect(results).toHaveLength(1); // in-flight note still reports
    expect(transport.calls).toHaveLength(1); // but nothing new starts
    queue.resume();
    await flush();
    expect(transport.calls).toHaveLength(2);
    second.resolve({ content: '{"proposals":[]}', latencyMs: 1 });
    await flush();
    expect(results).toHaveLength(2);
  });
});

describe("ExtractionQueue — cancel", () => {
  it("cancel mid-run drops the in-flight result, clears pending, stays usable", async () => {
    const inFlight = deferred<AiResponse>();
    const { queue, transport, results, progress } = makeHarness([
      () => inFlight.promise,
      proposalsResponse('{"proposals":[]}'),
    ]);
    queue.enqueue([NOTE_A, NOTE_B]);
    await flush();
    expect(transport.calls).toHaveLength(1);
    queue.cancel();
    expect(queue.pendingCount).toBe(0);
    inFlight.resolve({ content: '{"proposals":[]}', latencyMs: 1 });
    await flush();
    expect(results).toHaveLength(0); // cancelled in-flight result never surfaces
    expect(progress).toHaveLength(0);
    expect(transport.calls).toHaveLength(1); // pending note never requested
    // The queue is reusable after a cancel (fresh generation).
    queue.enqueue(NOTE_C);
    await queue.waitIdle();
    expect(results.map((r) => r.note.path)).toEqual(["c.md"]);
    expect(progress).toEqual([[1, 1]]);
  });

  it("cancel while paused with pending notes clears them silently", async () => {
    const first = deferred<AiResponse>();
    const { queue, results } = makeHarness([() => first.promise]);
    queue.enqueue([NOTE_A, NOTE_B]);
    await flush();
    queue.pause();
    queue.cancel();
    first.resolve({ content: '{"proposals":[]}', latencyMs: 1 });
    await flush();
    expect(results).toHaveLength(0);
    expect(queue.pendingCount).toBe(0);
  });
});

describe("ExtractionQueue — outcomes", () => {
  it("transport failure becomes an error outcome and the queue continues", async () => {
    const { queue, results } = makeHarness([
      () => Promise.reject(new AiError("auth", "HTTP 401", 401)),
      proposalsResponse('{"proposals":[]}'),
    ]);
    queue.enqueue([NOTE_A, NOTE_B]);
    await queue.waitIdle();
    expect(results).toHaveLength(2);
    expect(results[0].outcome.ok).toBe(false);
    if (!results[0].outcome.ok) {
      expect(results[0].outcome.error).toBeInstanceOf(AiError);
    }
    expect(results[1].outcome.ok).toBe(true);
  });

  it("malformed model JSON surfaces as a typed ExtractionParseError, never a throw", async () => {
    const { queue, results } = makeHarness([proposalsResponse("sorry, no json here")]);
    queue.enqueue(NOTE_A);
    await queue.waitIdle();
    const outcome = results[0].outcome;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(ExtractionParseError);
      expect((outcome.error as ExtractionParseError).kind).toBe("not-json");
    }
  });

  it("dedupes proposals against the note's existing frontmatter (B2 extractProposals)", async () => {
    const { queue, results } = makeHarness([
      proposalsResponse(
        JSON.stringify({
          proposals: [
            { kind: "entity", name: "A", entityType: "Place", confidence: 0.9 },
            { kind: "alias", alias: "A", confidence: 0.9 },
            { kind: "alias", alias: "Aldric", confidence: 0.8 },
          ],
        }),
      ),
    ]);
    queue.enqueue({ ...NOTE_A, type: "place" });
    await queue.waitIdle();
    const outcome = results[0].outcome;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      // Existing type "place" (case-insensitive) and the title itself dropped.
      expect(outcome.proposals.map((p) => p.kind)).toEqual(["alias"]);
    }
  });

  it("retries a 429 through the injected clock, then succeeds (one outcome)", async () => {
    const clock = new ManualClock();
    const transport = new ScriptedTransport(clock, [
      () => Promise.reject(new AiError("http", "HTTP 429", 429)),
      proposalsResponse('{"proposals":[]}'),
    ]);
    const results: ExtractionOutcome[] = [];
    const queue = new ExtractionQueue({
      transport,
      endpoint: ENDPOINT,
      clock,
      onResult: (_note, outcome) => results.push(outcome),
    });
    queue.enqueue(NOTE_A);
    await queue.waitIdle();
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(clock.t).toBeGreaterThanOrEqual(250); // backoff slept on the fake clock
  });
});

describe("ExtractionQueue — request shape", () => {
  it("builds an OpenAI-wire ChatRequest via buildChatRequest with the extraction prompt", async () => {
    const { queue, transport } = makeHarness([proposalsResponse('{"proposals":[]}')]);
    queue.enqueue(NOTE_A);
    await queue.waitIdle();
    const req = transport.calls[0].req;
    expect(req.baseUrl).toBe(ENDPOINT.baseUrl);
    expect(req.model).toBe(ENDPOINT.model);
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0].role).toBe("system");
    expect(req.messages[0].content).toContain("metadata extractor");
    expect(req.messages[1].role).toBe("user");
    expect(req.messages[1].content).toContain("a.md");
    expect(req.messages[1].content).toContain(NOTE_A.body);
    // No credential can ride along (ADR-006: key lives in the keyring).
    expect(Object.keys(req)).toEqual(["baseUrl", "model", "messages"]);
  });
});
