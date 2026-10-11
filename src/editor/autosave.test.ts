import { describe, expect, it, vi } from "vitest";
import { createAutosaveController, type AutosaveTimer } from "./autosave";

/**
 * Deterministic timer: tasks run when the fake clock reaches their deadline,
 * earliest first (ties broken by scheduling order).
 */
class FakeTimer implements AutosaveTimer {
  private nowMs = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; fn: () => void }>();

  set = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.nowMs + ms, fn });
    return id;
  };

  clear = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  advance(ms: number): void {
    this.nowMs += ms;
    for (;;) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= this.nowMs)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) return;
      this.tasks.delete(due[0]);
      due[1].fn();
    }
  }
}

function recorder(): { saves: Array<[string, string]>; save: (p: string, c: string) => void } {
  const saves: Array<[string, string]> = [];
  return { saves, save: (path, content) => void saves.push([path, content]) };
}

describe("createAutosaveController — debounce", () => {
  it("collapses rapid changes into one save carrying the newest content (default 800ms)", () => {
    const timer = new FakeTimer();
    const { saves, save } = recorder();
    const controller = createAutosaveController({ save, timer });

    controller.schedule("a.md", "v1");
    timer.advance(400);
    controller.schedule("a.md", "v2");
    timer.advance(400);
    controller.schedule("a.md", "v3");

    expect(saves).toEqual([]);
    timer.advance(800);

    expect(saves).toEqual([["a.md", "v3"]]);
    timer.advance(5000);
    expect(saves).toEqual([["a.md", "v3"]]); // no trailing re-save
  });

  it("honours a custom delayMs", () => {
    const timer = new FakeTimer();
    const { saves, save } = recorder();
    const controller = createAutosaveController({ save, timer, delayMs: 150 });

    controller.schedule("a.md", "v1");
    timer.advance(149);
    expect(saves).toEqual([]);
    timer.advance(1);
    expect(saves).toEqual([["a.md", "v1"]]);
  });

  it("debounces each path independently", () => {
    const timer = new FakeTimer();
    const { saves, save } = recorder();
    const controller = createAutosaveController({ save, timer });

    controller.schedule("a.md", "av1");
    timer.advance(300);
    controller.schedule("b.md", "bv1");
    timer.advance(500); // a.md fires (800ms since its schedule); b.md still pending

    expect(saves).toEqual([["a.md", "av1"]]);
    timer.advance(300);
    expect(saves).toEqual([
      ["a.md", "av1"],
      ["b.md", "bv1"],
    ]);
  });
});

describe("createAutosaveController — flush & cancel", () => {
  it("flush saves pending content immediately, without waiting for the delay", () => {
    const timer = new FakeTimer();
    const { saves, save } = recorder();
    const controller = createAutosaveController({ save, timer });

    controller.schedule("a.md", "draft");
    void controller.flush();

    expect(saves).toEqual([["a.md", "draft"]]);
    timer.advance(10_000);
    expect(saves).toEqual([["a.md", "draft"]]); // flushed timer was cleared
  });

  it("flush with nothing pending resolves cleanly", async () => {
    const { save } = recorder();
    const controller = createAutosaveController({ save, timer: new FakeTimer() });

    await expect(controller.flush()).resolves.toBeUndefined();
  });

  it("cancel suppresses scheduled saves for every path", () => {
    const timer = new FakeTimer();
    const { saves, save } = recorder();
    const controller = createAutosaveController({ save, timer });

    controller.schedule("a.md", "av1");
    controller.schedule("b.md", "bv1");
    controller.cancel();
    timer.advance(10_000);

    expect(saves).toEqual([]);
  });
});

describe("createAutosaveController — in-flight discipline", () => {
  it("runs only one save at a time; changes made mid-save save afterwards (newest wins)", async () => {
    const timer = new FakeTimer();
    const resolvers: Array<() => void> = [];
    const saves: Array<[string, string]> = [];
    const controller = createAutosaveController({
      save: (path, content) =>
        new Promise<void>((resolve) => {
          saves.push([path, content]);
          resolvers.push(resolve);
        }),
      timer,
    });

    controller.schedule("a.md", "v1");
    timer.advance(800); // save("a.md","v1") starts and stays pending
    expect(saves).toEqual([["a.md", "v1"]]);

    controller.schedule("a.md", "v2");
    controller.schedule("a.md", "v3"); // newest wins over v2
    timer.advance(800); // queued — second save must NOT start yet
    expect(saves).toEqual([["a.md", "v1"]]);

    const drained = controller.flush();
    resolvers[0]?.(); // finish the in-flight save
    await vi.waitFor(() => expect(resolvers).toHaveLength(2)); // queued save starts
    expect(saves).toEqual([
      ["a.md", "v1"],
      ["a.md", "v3"],
    ]);

    resolvers[1]?.();
    await drained;
  });

  it("flush resolves only after all queued saves complete", async () => {
    const timer = new FakeTimer();
    const resolvers: Array<() => void> = [];
    let finished = false;
    const controller = createAutosaveController({
      save: () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
      timer,
    });

    controller.schedule("a.md", "v1");
    timer.advance(800); // first save in flight
    const flushed = controller.flush().then(() => void (finished = true));

    await Promise.resolve();
    expect(finished).toBe(false);

    resolvers.forEach((resolve) => resolve());
    await flushed;
    expect(finished).toBe(true);
  });
});
