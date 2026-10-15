// @vitest-environment jsdom
/**
 * M2.5 I3 — API-key masking in the AI settings panel.
 *
 * Proves the key never reaches a rendered form: the field is a password
 * input with autocomplete off, it always starts empty, it is cleared after
 * every save attempt (success AND error), the secret appears nowhere in the
 * DOM after a save, and typing a key never commits settings via onChange.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiSettingsPanel, type AiSettingsPanelProps } from "./AiSettingsPanel";
import { DEFAULT_AI_SETTINGS } from "../core/ai/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Canary secret — any DOM trace of this string fails a test. */
const SECRET = "sk-test-do-not-leak-42";

let mounted: { root: Root; container: HTMLDivElement } | null = null;

function makeProps(overrides?: Partial<AiSettingsPanelProps>): AiSettingsPanelProps {
  return {
    open: true,
    settings: DEFAULT_AI_SETTINGS,
    keyPresent: false,
    onClose: vi.fn(),
    onChange: vi.fn(),
    onSaveKey: vi.fn(async () => ({ ok: true })),
    onTestConnection: vi.fn(async () => ({ ok: true, message: "ok" })),
    ...overrides,
  };
}

async function mountPanel(props: AiSettingsPanelProps): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AiSettingsPanel, props));
  });
  mounted = { root, container };
  return container;
}

async function rerender(props: AiSettingsPanelProps): Promise<void> {
  if (!mounted) throw new Error("rerender before mount");
  await act(async () => {
    mounted!.root.render(createElement(AiSettingsPanel, props));
  });
}

function keyInput(container: HTMLDivElement): HTMLInputElement {
  const input = container.querySelector("input[type='password']");
  expect(input, "password key input present").toBeTruthy();
  return input as HTMLInputElement;
}

async function typeKey(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  expect(setter, "native value setter available").toBeTruthy();
  await act(async () => {
    setter!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function clickButton(container: HTMLDivElement, label: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(button, `button "${label}" present`).toBeTruthy();
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

describe("AiSettingsPanel — the API key is never displayed (M2.5 I3)", () => {
  it("renders the key field as a password input with autocomplete off", async () => {
    const container = await mountPanel(makeProps());
    const input = keyInput(container);
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.value).toBe("");
  });

  it("clears the field after a successful save and shows only a notice", async () => {
    const props = makeProps();
    const container = await mountPanel(props);
    await typeKey(keyInput(container), SECRET);
    await clickButton(container, "Save key");
    expect(props.onSaveKey).toHaveBeenCalledWith(SECRET);
    expect(keyInput(container).value).toBe("");
    expect(container.textContent).toContain("key stored in OS keyring");
    expect(container.textContent).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it("clears the field even when the save fails (error path leaks nothing either)", async () => {
    const props = makeProps({
      onSaveKey: vi.fn(async () => ({ ok: false, error: "keyring storage error: boom" })),
    });
    const container = await mountPanel(props);
    await typeKey(keyInput(container), SECRET);
    await clickButton(container, "Save key");
    expect(keyInput(container).value).toBe("");
    expect(container.textContent).toContain("keyring storage error: boom");
    expect(container.textContent).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it("starts with an empty key field on every open (close + reopen never resurrects it)", async () => {
    const props = makeProps();
    const container = await mountPanel(props);
    await typeKey(keyInput(container), SECRET);
    await clickButton(container, "Save key");
    await rerender({ ...props, open: false });
    await rerender({ ...props, open: true });
    expect(keyInput(container).value).toBe("");
    expect(container.innerHTML).not.toContain(SECRET);
  });

  it("never routes key material into committed settings (onChange)", async () => {
    const props = makeProps();
    const container = await mountPanel(props);
    await typeKey(keyInput(container), SECRET);
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
