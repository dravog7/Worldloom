// @vitest-environment jsdom
/**
 * WIKILINK-COMPLETION-UI regression (e2e spec "typing [[ opens the wikilink
 * completion list", e2e diag DIAG-G8): in the live editor, typing "[[" must
 * open the CM6 autocomplete tooltip.
 *
 * This mounts the REAL LiveEditor (same extension assembly that ships in the
 * app) and drives its view with the exact transaction shape the browser input
 * path produces — `closeBrackets`' insertBracket and CM6's applyDOMChange both
 * dispatch with `userEvent: "input.type"` (see @codemirror/autocomplete
 * `insertBracket` and @codemirror/view `applyDOMChangeInner`). The completion
 * state machine only auto-activates on that user event
 * (`getUpdateType`: typing && activateOnTyping), so this is the faithful
 * headless stand-in for typing; the e2e spec covers the real keystrokes.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Transaction } from "@codemirror/state";
import { acceptCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { LiveEditor } from "./LiveEditor";
import type { WikilinkLookup } from "../autocomplete";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOTES = [
  { title: "Misthollow", path: "places/misthollow.md", aliases: [] as string[] },
  { title: "Mistwood", path: "places/mistwood.md", aliases: [] as string[] },
  { title: "Vael'Thor", path: "places/vael-thor.md", aliases: ["The Spire"] },
];

/** Prefix-ranked lookup — stands in for MemoryIndex.byTitleOrAlias. */
const lookup: WikilinkLookup = (query) => {
  const q = query.toLowerCase();
  return NOTES.filter((n) => n.title.toLowerCase().startsWith(q));
};

let mounted: { root: Root; container: HTMLDivElement } | null = null;

async function mountLiveEditor(content = "# Aelindra\n"): Promise<EditorView> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(LiveEditor, {
        path: "people/aelindra.md",
        content,
        lookup,
        onSave: () => undefined,
        onStatusChange: () => undefined,
        mode: "live",
        reveal: null,
      }),
    );
  });
  mounted = { root, container };
  const contentDom = container.querySelector(".cm-content");
  expect(contentDom, "LiveEditor mounted a CM6 content element").toBeTruthy();
  const view = EditorView.findFromDOM(contentDom as HTMLElement);
  expect(view, "EditorView.findFromDOM resolves the live editor view").toBeTruthy();
  return view as EditorView;
}

/** Type one character exactly as the browser input path dispatches it. */
function typeChar(view: EditorView, text: string): void {
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    annotations: Transaction.userEvent.of("input.type"),
  });
}

/** Let the completion plugin's activateOnTypingDelay debounce fire. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

afterEach(async () => {
  if (mounted) {
    const { root, container } = mounted;
    await act(async () => root.unmount());
    container.remove();
    mounted = null;
  }
});

describe("LiveEditor wikilink completion UI", () => {
  it("typing [[ opens the autocomplete tooltip with every note", async () => {
    const view = await mountLiveEditor();

    await act(async () => {
      typeChar(view, "[");
      typeChar(view, "[");
    });
    await settle();

    const tooltip = document.body.querySelector(".cm-tooltip-autocomplete");
    expect(tooltip, "tooltip opens after typing [[").toBeTruthy();
    expect(tooltip!.querySelectorAll("li").length).toBe(NOTES.length);
    view.destroy();
  });

  it("typing a partial title filters the open list; accepting inserts [[Title]]", async () => {
    const view = await mountLiveEditor();

    await act(async () => {
      typeChar(view, "[");
      typeChar(view, "[");
      typeChar(view, "Mist");
    });
    await settle();

    const tooltip = document.body.querySelector(".cm-tooltip-autocomplete");
    expect(tooltip, "tooltip stays open while typing the query").toBeTruthy();
    const items = [...tooltip!.querySelectorAll("li")].map((li) => li.textContent);
    expect(items.some((t) => t!.includes("Misthollow"))).toBe(true);
    expect(items.some((t) => t!.includes("Mistwood"))).toBe(true);
    expect(items.some((t) => t!.includes("Vael'Thor"))).toBe(false);

    // Accept the highlighted completion (the same command Enter runs via
    // completionKeymap in the app).
    await act(async () => {
      acceptCompletion(view);
    });
    expect(view.state.doc.toString()).toContain("[[Misthollow]]");
    view.destroy();
  });
});
