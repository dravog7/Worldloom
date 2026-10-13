// @vitest-environment jsdom
/**
 * M2 I1 — App shell wiring for the AI right-rail.
 *
 * Proves the integration contract, not panel internals (those have their own
 * suites): the header tabs toggle the rail, the Audit tab mounts FindingsPanel,
 * the Extract tab mounts ExtractionPanel for the open note (or a setup hint),
 * and the Ask tab only mounts AskPanel when an index exists (a vault is open).
 *
 * Tauri-facing modules are mocked at the module boundary; `boot` is stubbed so
 * the seeded store state survives mount (boot would otherwise flip a jsdom
 * app to "no-vault").
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./app/adapters/ai-key", () => ({
  chatViaProxy: vi.fn(async () => ({ content: "ok", latencyMs: 1 })),
  setAiKey: vi.fn(async () => undefined),
  getAiKeyStatus: vi.fn(async () => false),
  keyringErrorMessage: (e: unknown) => String(e),
}));

vi.mock("./app/adapters/audit-state", () => ({
  tauriAuditStatePort: () => ({
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
  }),
}));

import App from "./App";
import { useStore } from "./app/store";
import { DEFAULT_AI_SETTINGS } from "./core/ai/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; container: HTMLDivElement } | null = null;

async function mountApp(): Promise<HTMLDivElement> {
  // Merge (never replace) so store actions survive the seed.
  useStore.setState({
    status: "ready",
    vaultName: "test-vault",
    tree: [],
    currentPath: null,
    currentContent: "",
    backlinks: [],
    aiSettings: DEFAULT_AI_SETTINGS,
    aiKeyPresent: false,
  });
  vi.spyOn(useStore.getState(), "boot").mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(App));
  });
  mounted = { root, container };
  return container;
}

/** Click a header tab by its visible label. */
async function clickTab(container: HTMLDivElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  );
  expect(button, `tab "${label}" present`).toBeTruthy();
  await act(async () => button!.click());
}

afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
  vi.restoreAllMocks();
});

describe("App — AI right rail (M2 I1)", () => {
  it("renders the Audit / Extract / Ask tabs in the header", async () => {
    const container = await mountApp();
    const labels = [...container.querySelectorAll("header button")].map((b) => b.textContent);
    expect(labels).toContain("Audit");
    expect(labels).toContain("Extract");
    expect(labels).toContain("Ask");
  });

  it("Audit tab mounts the Findings panel (rules pass works with no vault note open)", async () => {
    const container = await mountApp();
    await clickTab(container, "Audit");
    expect(container.querySelector("section[aria-label='Findings']")).toBeTruthy();
    expect(container.textContent).toContain("Run audit");
  });

  it("Audit tab toggles off on a second click", async () => {
    const container = await mountApp();
    await clickTab(container, "Audit");
    await clickTab(container, "Audit");
    expect(container.querySelector("section[aria-label='Findings']")).toBeNull();
  });

  it("Extract tab with no note open shows the open-a-note hint, not the panel", async () => {
    const container = await mountApp();
    await clickTab(container, "Extract");
    expect(container.textContent).toContain("Open a note to extract entities");
    expect(container.textContent).not.toContain("Extract entities");
  });

  it("Ask tab without an open vault index renders an empty rail (no transport calls)", async () => {
    const container = await mountApp();
    await clickTab(container, "Ask");
    // No index ⇒ AskPanel must not mount; nothing in the rail renders.
    expect(container.querySelector("aside[aria-label='AI panel']")).toBeTruthy();
    expect(container.querySelector("input[placeholder='Ask your world…']")).toBeNull();
  });

  it("switching tabs replaces the previous panel", async () => {
    const container = await mountApp();
    await clickTab(container, "Audit");
    expect(container.querySelector("section[aria-label='Findings']")).toBeTruthy();
    await clickTab(container, "Extract");
    expect(container.querySelector("section[aria-label='Findings']")).toBeNull();
    expect(container.textContent).toContain("Open a note to extract entities");
  });
});
