// @vitest-environment jsdom
/**
 * W2 toolbar row: presentational only — the dropdown reflects state.block
 * and forwards the matching action, buttons forward their action, inline
 * flags light `wl-md-btn-active`, and mousedown is swallowed so clicking
 * never steals the editor selection.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolbarRow, type ToolbarRowProps } from "./ToolbarRow";
import type { ToolbarAction, ToolbarState } from "./toolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDLE: ToolbarState = {
  block: "normal",
  inline: { bold: false, italic: false, strike: false, code: false, underline: false },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(overrides: Partial<ToolbarRowProps> = {}) {
  const calls: ToolbarAction[] = [];
  const props: ToolbarRowProps = {
    state: overrides.state ?? IDLE,
    onAction: overrides.onAction ?? ((action) => calls.push(action)),
  };
  act(() => {
    root.render(createElement(ToolbarRow, props));
  });
  return { calls };
}

function button(title: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (!el) throw new Error(`no button titled ${title}`);
  return el;
}

function click(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("ToolbarRow", () => {
  it("renders the style dropdown bound to the current block", () => {
    render({ state: { ...IDLE, block: "h2" } });
    const select = container.querySelector<HTMLSelectElement>("select[aria-label='Text style']");
    expect(select).not.toBeNull();
    expect(select!.value).toBe("h2");
    const labels = [...select!.options].map((o) => o.textContent);
    expect(labels).toEqual(["Normal", "Heading 1", "Heading 2", "Heading 3"]);
  });

  it("fires the matching block action when the style changes", () => {
    const { calls } = render();
    const select = container.querySelector<HTMLSelectElement>("select[aria-label='Text style']")!;
    act(() => {
      select.value = "h1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(calls).toEqual(["h1"]);
  });

  it("renders every toggle button with its title", () => {
    render();
    const titles = [...container.querySelectorAll("button")].map((b) => b.title);
    expect(titles).toEqual([
      "Bold",
      "Italic",
      "Strikethrough",
      "Underline",
      "Inline code",
      "Bulleted list",
      "Numbered list",
      "Quote",
      "Wikilink",
      "Indent",
      "Outdent",
    ]);
  });

  it("clicking a button forwards its action", () => {
    const { calls } = render();
    click(button("Bold"));
    click(button("Numbered list"));
    click(button("Indent"));
    expect(calls).toEqual(["bold", "numbered", "indent"]);
  });

  it("lights the active class for the inline flags in the state", () => {
    render({
      state: {
        ...IDLE,
        inline: { bold: true, italic: false, strike: true, code: false, underline: false },
      },
    });
    expect(button("Bold").className).toContain("wl-md-btn-active");
    expect(button("Strikethrough").className).toContain("wl-md-btn-active");
    expect(button("Italic").className).not.toContain("wl-md-btn-active");
  });

  it("prevents the default on mousedown so the editor keeps its selection", () => {
    render();
    const target = button("Bold");
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });
});
