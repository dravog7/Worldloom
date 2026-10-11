/**
 * Injectable timer abstraction so the 150ms watcher debounce (ARCH.md data
 * flow) is deterministic in tests: VaultService never touches setTimeout
 * directly, it goes through this port.
 */
export interface TimerPort {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

/** Real-timer implementation used in production (Tauri renderer). */
export const systemTimer: TimerPort = {
  setTimeout(fn: () => void, ms: number): unknown {
    return setTimeout(fn, ms) as TimeoutHandle;
  },
  clearTimeout(handle: unknown): void {
    clearTimeout(handle as TimeoutHandle);
  },
};

interface QueuedTimer {
  id: number;
  at: number;
  fn: () => void;
}

/**
 * Deterministic test double: timers fire only when `advance(ms)` is called,
 * in scheduling order. Shared by vault unit tests and the smoke integration.
 */
export class ManualTimer implements TimerPort {
  private seq = 0;
  private now = 0;
  private queue: QueuedTimer[] = [];

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.queue.push({ id, at: this.now + ms, fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter((t) => t.id !== handle);
  }

  /** Advance virtual time, firing every timer that comes due (earliest first). */
  advance(ms: number): void {
    this.now += ms;
    for (;;) {
      const due = this.queue
        .filter((t) => t.at <= this.now)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) return;
      this.queue = this.queue.filter((t) => t !== due);
      due.fn();
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}
