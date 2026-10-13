// @vitest-environment jsdom
/**
 * M2 I4 — Findings panel: the paid LLM pass must not be single-use.
 *
 * (2a) Findings survive a panel unmount/remount (the App rail conditionally
 *      renders panels, so switching to another tab unmounts this one).
 * (2b) Re-auditing an unchanged vault keeps the LLM findings and never
 *      re-spends (plan.batches === 0 after lastAudit is recorded).
 * (H1) Escape closes the cost-estimate confirm dialog.
 *
 * Uses the module-singleton findings store on purpose — that singleton is
 * exactly what must carry the findings across remounts; each test resets it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_SETTINGS } from "../core/ai/settings";
import type { Transport } from "../core/ai/types";
import type { AuditStatePort } from "../core/audit/llm";
import { FakeIndex, makeNote } from "../core/vault/test-fakes";
import { FindingsPanel, type FindingsPanelProps } from "./FindingsPanel";
import { useFindingsUi } from "./findings-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** In-memory AuditStatePort fake (D1 contract). */
class MemoryAuditStatePort implements AuditStatePort {
  raw: string | null = null;
  async read(): Promise<string | null> {
    return this.raw;
  }
  async write(serialized: string): Promise<void> {
    this.raw = serialized;
  }
}

/** Seeded vault: one duplicate alias + one missing relation + one dead link. */
function seededIndex(): FakeIndex {
  const index = new FakeIndex();
  index.upsert(
    makeNote("people/Ellara.md", {
      title: "Ellara",
      aliases: ["The Tideborn"],
      body: "Captain of the Meridian.",
      mtime: 100,
    }),
  );
  index.upsert(
    makeNote("people/Ellara-of-the-Sea.md", {
      title: "Ellara",
      body: "A different Ellara entirely.",
      mtime: 101,
    }),
  );
  index.upsert(
    makeNote("places/Vael'Thor.md", {
      title: "Vael'Thor",
      relations: [{ kind: "ruler", target: "Ghost Queen" }],
      links: [{ source: "places/Vael'Thor.md", target: "The Unmade", line: 3 }],
      body: "The drowned city.\nSee [[The Unmade]].",
      mtime: 102,
    }),
  );
  return index;
}

/** Verified audit reply: both quotes are verbatim in the seeded bodies. */
const AUDIT_REPLY = JSON.stringify({
  findings: [
    {
      noteA: "people/Ellara.md",
      quoteA: "Captain of the Meridian.",
      noteB: "people/Ellara-of-the-Sea.md",
      quoteB: "A different Ellara entirely.",
      message: "Two different Ellaras share one name",
      confidence: 0.92,
    },
  ],
});

function chatTransport(): { transport: Transport; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn(async () => ({ content: AUDIT_REPLY, latencyMs: 1 }));
  return { transport: { chat }, chat };
}

function panelProps(
  index: FakeIndex,
  port: AuditStatePort,
  transport: Transport,
): FindingsPanelProps {
  return {
    provider: index,
    auditStatePort: port,
    aiSettings: DEFAULT_AI_SETTINGS,
    aiKeyPresent: true,
    transport,
    onOpenNote: () => {},
  };
}

let mounted: { root: Root; container: HTMLDivElement } | null = null;

async function mountPanel(
  props: FindingsPanelProps,
): Promise<{ container: HTMLDivElement; remount: () => Promise<HTMLDivElement> }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted = { root, container };
  await act(async () => {
    root.render(createElement(FindingsPanel, props));
  });
  return {
    container,
    // Simulates the rail unmounting the panel (tab switch) and mounting it anew.
    remount: async () => {
      await act(async () => root.unmount());
      container.remove();
      const next = document.createElement("div");
      document.body.appendChild(next);
      const nextRoot = createRoot(next);
      mounted = { root: nextRoot, container: next };
      await act(async () => {
        nextRoot.render(createElement(FindingsPanel, props));
      });
      return next;
    },
  };
}

async function clickButton(root: ParentNode, label: string): Promise<void> {
  const button = [...root.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(button, `button "${label}" present`).toBeTruthy();
  await act(async () => (button as HTMLButtonElement).click());
}

async function expandGroup(root: ParentNode, path: string): Promise<void> {
  const header = [...root.querySelectorAll(".wl-finding-group-header")].find((b) =>
    b.textContent?.includes(path),
  );
  expect(header, `group "${path}" present`).toBeTruthy();
  if (header!.getAttribute("aria-expanded") === "false") {
    await act(async () => (header as HTMLButtonElement).click());
  }
}

beforeEach(() => {
  useFindingsUi.getState().reset();
});

afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
  useFindingsUi.getState().reset();
});

describe("FindingsPanel — LLM findings are not single-use (M2 I4 #2)", () => {
  it("keeps paid LLM findings across an unmount/remount (rail tab switch) without re-spending", async () => {
    const index = seededIndex();
    const { transport, chat } = chatTransport();
    const harness = await mountPanel(
      panelProps(index, new MemoryAuditStatePort(), transport),
    );

    await clickButton(harness.container, "Run audit");
    expect(harness.container.querySelector("[role='dialog']")).toBeTruthy();
    await clickButton(harness.container, "Run AI pass");
    await expandGroup(harness.container, "people/Ellara.md");
    expect(harness.container.textContent).toContain(
      "Two different Ellaras share one name",
    );
    expect(chat).toHaveBeenCalledTimes(1);

    // Rail tab switch away and back — the panel unmounts and remounts.
    const remounted = await harness.remount();
    await expandGroup(remounted, "people/Ellara.md");
    expect(remounted.textContent).toContain("AI contradiction");
    expect(remounted.textContent).toContain(
      "Two different Ellaras share one name",
    );
    expect(chat).toHaveBeenCalledTimes(1); // nothing re-ran
    expect(
      [...remounted.querySelectorAll("button")].some((b) => b.textContent === "Re-audit"),
    ).toBe(true);
  });

  it("re-audit of an unchanged vault keeps the LLM findings and sends nothing new", async () => {
    const index = seededIndex();
    const { transport, chat } = chatTransport();
    const harness = await mountPanel(
      panelProps(index, new MemoryAuditStatePort(), transport),
    );

    await clickButton(harness.container, "Run audit");
    await clickButton(harness.container, "Run AI pass");
    await expandGroup(harness.container, "people/Ellara.md");
    expect(harness.container.textContent).toContain(
      "Two different Ellaras share one name",
    );

    // All notes were just audited (lastAudit == mtime) → no batches, no cost
    // dialog, but the paid findings must remain on screen.
    await clickButton(harness.container, "Re-audit");
    await expandGroup(harness.container, "people/Ellara.md");
    expect(harness.container.textContent).toContain(
      "Two different Ellaras share one name",
    );
    expect(chat).toHaveBeenCalledTimes(1);
    expect(harness.container.querySelector("[role='dialog']")).toBeNull();
  });
});

describe("FindingsPanel — confirm dialog a11y (I4 hardening H1)", () => {
  it("Escape closes the cost-estimate dialog and frees the run button", async () => {
    const index = seededIndex();
    const { transport, chat } = chatTransport();
    const harness = await mountPanel(
      panelProps(index, new MemoryAuditStatePort(), transport),
    );

    await clickButton(harness.container, "Run audit");
    const dialog = harness.container.querySelector("[role='dialog']");
    expect(dialog).toBeTruthy();
    await act(async () =>
      (dialog as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(harness.container.querySelector("[role='dialog']")).toBeNull();
    expect(chat).not.toHaveBeenCalled();
    expect(
      [...harness.container.querySelectorAll("button")].some(
        (b) => b.textContent === "Re-audit",
      ),
    ).toBe(true);
  });
});
