// @vitest-environment jsdom
/**
 * W4 — Note properties popover: renders read-only frontmatter fields,
 * hides when closed or note-less, never exposes editing controls (the
 * internal-form decision: frontmatter is edited via extraction Accept,
 * not by hand in this popover).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { NoteProperties } from "./NoteProperties";
import type { Note } from "../core/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE: Note = {
  path: "Stories/Test.md",
  title: "Test",
  type: "story",
  aliases: ["T1", "T2"],
  tags: ["tagged"],
  relations: [],
  body: "body",
  links: [],
  mtime: 0,
};

let mounted: { root: Root; container: HTMLDivElement } | null = null;

async function mount(props: Partial<Parameters<typeof NoteProperties>[0]>): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(NoteProperties, {
        open: true,
        note: NOTE,
        onClose: () => undefined,
        ...props,
      }),
    );
  });
  mounted = { root, container };
  return container;
}

afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
});

describe("NoteProperties (W4)", () => {
  it("renders path, title, type, aliases, tags as read-only rows", async () => {
    const container = await mount({});
    expect(container.textContent).toContain("Stories/Test.md");
    expect(container.textContent).toContain("Test");
    expect(container.textContent).toContain("story");
    expect(container.textContent).toContain("T1, T2");
    expect(container.textContent).toContain("tagged");
  });

  it("renders an em-dash for absent fields", async () => {
    const container = await mount({ note: { ...NOTE, type: undefined } });
    const rows = [...container.querySelectorAll(".wl-props-row")];
    const typeRow = rows.find((r) => r.textContent?.includes("Type"));
    expect(typeRow?.textContent).toContain("—");
  });

  it("renders nothing when closed or note-less", async () => {
    const closed = await mount({ open: false });
    expect(closed.querySelector(".wl-props-popover")).toBeNull();
    const noNote = await mount({ note: null });
    expect(noNote.querySelector(".wl-props-popover")).toBeNull();
  });

  it("offers no editing affordances (internal-form decision)", async () => {
    const container = await mount({});
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
  });

  it("close button fires onClose", async () => {
    let closed = 0;
    const container = await mount({ onClose: () => (closed += 1) });
    await act(async () =>
      container.querySelector<HTMLButtonElement>("button[aria-label='Close properties']")?.click(),
    );
    expect(closed).toBe(1);
  });
});
