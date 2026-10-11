/**
 * Autosave controller (PLAN-M1 C1): per-path debounce feeding `vault.save`,
 * with a strict single-in-flight-save queue and newest-content-wins.
 *
 * All scheduling is routed through an injectable `AutosaveTimer`, so tests
 * drive a deterministic fake clock instead of wall time.
 */

export interface AutosaveOptions {
  /** Persists one note; may be async (atomic temp+rename in src/core/vault). */
  save: (path: string, content: string) => void | Promise<void>;
  /** Debounce window; 800ms per PLAN-M1 C1. */
  delayMs?: number;
  /** Timer backend; defaults to setTimeout/clearTimeout. */
  timer?: AutosaveTimer;
}

/** Minimal timer surface — `setTimeout`/`clearTimeout` satisfy it. */
export interface AutosaveTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface AutosaveController {
  /** Record the newest content for `path`, (re)starting its debounce. */
  schedule(path: string, content: string): void;
  /** Save all pending content now; resolves when the queue fully drains. */
  flush(): Promise<void>;
  /** Drop everything not yet started (an in-flight save cannot be aborted). */
  cancel(): void;
}

const defaultTimer: AutosaveTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** True for anything promise-like (async save() results). */
function isThenable(value: void | Promise<void>): value is Promise<void> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Promise<void>).then === "function"
  );
}

/** Internal queue entry: content snapshot + its live debounce handle. */
interface Pending {
  content: string;
  handle?: unknown;
}

export function createAutosaveController(
  options: AutosaveOptions,
): AutosaveController {
  const { save, delayMs = 800, timer = defaultTimer } = options;

  /** Not-yet-saved content, keyed by path — the debounce layer. */
  const pending = new Map<string, Pending>();
  /** Saves ready to run, at most one in flight; newest content per path. */
  const jobs: Array<{ path: string; content: string }> = [];
  /** True while the drain loop holds the baton (set/cleared synchronously). */
  let running = false;
  let drainPromise: Promise<void> | null = null;

  /** Queue a save, deduplicating by path (newest content wins). */
  function enqueue(path: string, content: string): void {
    const queued = jobs.findIndex((job) => job.path === path);
    if (queued === -1) jobs.push({ path, content });
    else jobs[queued] = { path, content };
    if (running) return;
    running = true;
    drainPromise = drain();
  }

  /**
   * Serial save loop — guarantees at most one save() in flight. Synchronous
   * saves drain in the same tick; only thenable saves suspend the loop.
   */
  async function drain(): Promise<void> {
    try {
      while (jobs.length > 0) {
        const job = jobs.shift();
        if (!job) break;
        try {
          const result = save(job.path, job.content);
          if (isThenable(result)) await result;
        } catch (error) {
          // Timer-initiated drains are never awaited — swallow here so a
          // failing save can't become an unhandled rejection. flush()
          // callers observe completion, not failure (I1 wires retry policy).
          console.error(`[autosave] save failed for ${job.path}`, error);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    schedule(path: string, content: string): void {
      const existing = pending.get(path);
      if (existing && existing.handle !== undefined) {
        timer.clear(existing.handle);
      }
      const entry: Pending = { content };
      entry.handle = timer.set(() => {
        pending.delete(path);
        enqueue(path, content);
      }, delayMs);
      pending.set(path, entry);
    },

    flush(): Promise<void> {
      for (const [path, entry] of pending) {
        if (entry.handle !== undefined) timer.clear(entry.handle);
        enqueue(path, entry.content);
      }
      pending.clear();
      return drainPromise ?? Promise.resolve();
    },

    cancel(): void {
      for (const entry of pending.values()) {
        if (entry.handle !== undefined) timer.clear(entry.handle);
      }
      pending.clear();
      jobs.length = 0;
    },
  };
}
