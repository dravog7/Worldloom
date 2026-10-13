// @vitest-environment jsdom
/**
 * M2 I4 — ExtractionPanel note-switch race (#3): an extraction started on
 * note A must never render into — and therefore never be accepted into —
 * note B after a switch while the model is still working.
 *
 * Plus I4 hardening (H2): an accept whose save lands after a note switch
 * must not flash "✓ applied to frontmatter" under the new note.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Transport } from "../core/ai/types";
import {
  ExtractionPanel,
  type ExtractionPanelNote,
  type ExtractionPanelProps,
} from "./ExtractionPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function note(path: string): ExtractionPanelNote {
  return {
    path,
    title: path.replace(/\.md$/, ""),
    body: "The Meridian sails at dawn.",
    source: `# ${path}\n`,
  };
}

const EXTRACT_OK = JSON.stringify({
  proposals: [{ kind: "entity", name: "Meridian", entityType: "place", confidence: 0.9 }],
});

/** Transport whose response the test controls (deferred, one settle per call). */
function deferredTransport(): {
  transport: Transport;
  resolve: (content?: string) => void;
  calls: () => number;
} {
  let settle: ((response: { content: string; latencyMs: number }) => void) | null = null;
  let count = 0;
  const transport: Transport = {
    chat: () => {
      count += 1;
      return new Promise((resolve) => {
        settle = resolve;
      });
    },
  };
  return {
    transport,
    resolve: (content = EXTRACT_OK) => settle?.({ content, latencyMs: 1 }),
    calls: () => count,
  };
}

type SaveFn = (path: string, newSource: string) => Promise<void>;

/** Save seam the test controls (deferred promise). */
function deferredSave(): {
  onSave: SaveFn & ReturnType<typeof vi.fn>;
  resolve: () => void;
} {
  let settle: (() => void) | null = null;
  const onSave = vi.fn<SaveFn>(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  return { onSave, resolve: () => settle?.() };
}

let mounted: { root: Root; container: HTMLDivElement } | null = null;

async function mountPanel(props: ExtractionPanelProps): Promise<{
  container: HTMLDivElement;
  rerender: (next: ExtractionPanelProps) => Promise<void>;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(createElement(ExtractionPanel, props));
  });
  return {
    container,
    // Re-renders with a new note — same transport/endpoint identities, so
    // only the note-switch effect (not a queue swap) can explain changes.
    rerender: async (next) => {
      await act(async () => {
        root.render(createElement(ExtractionPanel, next));
      });
    },
  };
}

function baseProps(overrides: Partial<ExtractionPanelProps>): ExtractionPanelProps {
  return {
    note: note("notes/A.md"),
    transport: { chat: vi.fn(async () => ({ content: EXTRACT_OK, latencyMs: 1 })) },
    endpoint: { baseUrl: "https://api.openai.com/v1", model: "test-model" },
    aiConfigured: true,
    onSave: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function clickButton(root: ParentNode, label: string): Promise<void> {
  const button = [...root.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(button, `button "${label}" present`).toBeTruthy();
  await act(async () => (button as HTMLButtonElement).click());
}

/** Polls (inside act) until `predicate` holds — for rate-capped async starts. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("waitFor: condition never became true");
    }
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
});

describe("ExtractionPanel — note-switch race (M2 I4 #3)", () => {
  it("switching notes mid-extraction cancels the run — note A's proposals never render for note B", async () => {
    const { transport, resolve, calls } = deferredTransport();
    const props = baseProps({ transport });
    const harness = await mountPanel(props);

    await clickButton(harness.container, "Extract entities");
    expect(harness.container.textContent).toContain("Extracting…");

    // Switch to note B while note A's request is still in flight.
    await harness.rerender({ ...props, note: note("notes/B.md") });

    // Note A's reply lands afterwards — it must not surface for note B.
    await act(async () => resolve());
    expect(harness.container.querySelector(".wl-extract-check")).toBeNull();
    expect(harness.container.textContent).toContain("No pending proposals");

    // And the queue is not wedged: extraction still works for note B. The
    // start-rate cap may hold note B for up to one interval before its
    // request goes out — wait for the actual call, then settle it.
    await clickButton(harness.container, "Extract entities");
    await waitFor(() => calls() === 2);
    await act(async () => resolve());
    expect(harness.container.querySelectorAll(".wl-extract-check")).toHaveLength(1);
  });
});

describe("ExtractionPanel — accept-after-switch hardening (I4 H2)", () => {
  it("a save that finishes after a note switch does not flash 'applied' under the new note", async () => {
    const transport: Transport = {
      chat: vi.fn(async () => ({ content: EXTRACT_OK, latencyMs: 1 })),
    };
    const { onSave, resolve: resolveSave } = deferredSave();
    const props = baseProps({ transport, onSave });
    const harness = await mountPanel(props);

    await clickButton(harness.container, "Extract entities");
    expect(harness.container.querySelector(".wl-extract-check")).toBeTruthy();

    // Accept on note A; the vault save is still pending when the user
    // switches to note B.
    await clickButton(harness.container, "Accept selected (1)");
    expect(onSave).toHaveBeenCalledWith("notes/A.md", expect.any(String));
    await harness.rerender({ ...props, note: note("notes/B.md") });
    await act(async () => resolveSave());

    expect(harness.container.textContent).not.toContain("applied to frontmatter");
  });
});
