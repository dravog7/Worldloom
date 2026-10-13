// @vitest-environment jsdom
/**
 * M2 Wave C2 — <AiGate> (PRD-M2 §5): AI surfaces must degrade to a setup CTA,
 * never render their (invoke-capable) children while unconfigured.
 *
 * The store's INITIAL state is what `renderToString` sees (zustand's
 * useSyncExternalStore server snapshot reads getInitialState), so every case
 * below creates a fresh isolated store via useStore.create() and mounts into
 * jsdom. That also lets us assert the mount-time keyring fetch and the CTA
 * click. The click is asserted against the same contract App.tsx uses to open
 * AiSettingsPanel — the store's `openAiSettings()` zustand action.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiGate } from "./AiGate";
import { useStore } from "./store";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "../core/ai/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHILD = createElement("span", null, "child surface");

const OLLAMA: AiSettings = {
  ...DEFAULT_AI_SETTINGS,
  preset: "ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "llama3.2",
};

let mounted: { root: Root; container: HTMLDivElement } | null = null;

/** Mount the gate on an isolated store whose AI settings/key state we seed. */
async function mountGate(
  seed: { aiSettings: AiSettings; aiKeyPresent: boolean | null },
  props: { onOpenSettings?: () => void } = {},
  children: ReactNode = CHILD,
  /** Runs after the seed but before render — zustand setState swaps the state object, so spies go here. */
  onSeeded?: () => void,
): Promise<HTMLDivElement> {
  // Merge (never replace): a replace would drop the store's actions.
  useStore.setState(seed);
  onSeeded?.();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AiGate, props, children));
  });
  mounted = { root, container };
  return container;
}

afterEach(async () => {
  if (mounted) {
    await act(async () => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
  useStore.setState({ aiSettings: DEFAULT_AI_SETTINGS, aiKeyPresent: null, aiSettingsOpen: false });
  vi.restoreAllMocks();
});

describe("AiGate render contract", () => {
  it("renders children when configured (local endpoint, no key needed)", async () => {
    const container = await mountGate({ aiSettings: OLLAMA, aiKeyPresent: false });
    expect(container.textContent).toContain("child surface");
    expect(container.textContent).not.toContain("Set up AI");
  });

  it("renders the setup CTA instead of children when unconfigured", async () => {
    const container = await mountGate({ aiSettings: DEFAULT_AI_SETTINGS, aiKeyPresent: false });
    expect(container.textContent).toContain("Set up AI");
    expect(container.textContent).toContain("no API key stored");
    expect(container.textContent).not.toContain("child surface");
  });

  it("surfaces every blocking reason in the CTA copy", async () => {
    const container = await mountGate({
      aiSettings: { ...DEFAULT_AI_SETTINGS, preset: "custom", baseUrl: "junk", model: "" },
      aiKeyPresent: false,
    });
    expect(container.textContent).toContain("endpoint is not a URL");
    expect(container.textContent).toContain("no model selected");
    expect(container.textContent).toContain("no API key stored");
  });
});

describe("AiGate interaction", () => {
  it("clicking the CTA opens AI settings via the store (App.tsx contract)", async () => {
    const container = await mountGate({ aiSettings: DEFAULT_AI_SETTINGS, aiKeyPresent: false });
    const button = container.querySelector("button");
    expect(button?.textContent).toBe("Set up AI");
    await act(async () => button?.click());
    expect(useStore.getState().aiSettingsOpen).toBe(true);
  });

  it("honours an onOpenSettings override instead of the store", async () => {
    const onOpenSettings = vi.fn();
    const container = await mountGate(
      { aiSettings: DEFAULT_AI_SETTINGS, aiKeyPresent: false },
      { onOpenSettings },
    );
    await act(async () => container.querySelector("button")?.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(useStore.getState().aiSettingsOpen).toBe(false);
  });

  it("fetches key presence once on mount (cached, null → refreshed)", async () => {
    let refresh!: ReturnType<typeof vi.fn>;
    await mountGate({ aiSettings: OLLAMA, aiKeyPresent: null }, {}, CHILD, () => {
      refresh = vi
        .spyOn(useStore.getState(), "refreshAiKeyStatus")
        .mockResolvedValue(undefined) as unknown as ReturnType<typeof vi.fn>;
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch key presence when it is already known", async () => {
    let refresh!: ReturnType<typeof vi.fn>;
    await mountGate({ aiSettings: OLLAMA, aiKeyPresent: true }, {}, CHILD, () => {
      refresh = vi
        .spyOn(useStore.getState(), "refreshAiKeyStatus")
        .mockResolvedValue(undefined) as unknown as ReturnType<typeof vi.fn>;
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
