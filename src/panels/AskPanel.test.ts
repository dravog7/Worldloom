import { describe, expect, it } from "vitest";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AiError } from "../core/ai/types";
import type { Transport } from "../core/ai/types";
import { MemoryIndex } from "../core/index/memory-index";
import type { Note } from "../core/types";
import { AskPanel } from "./AskPanel";

function note(path: string, body: string, extra: Partial<Note> = {}): Note {
  const stem = path.replace(/\.md$/, "").split("/").pop() ?? path;
  return {
    path,
    title: stem,
    aliases: [],
    tags: [],
    relations: [],
    body,
    links: [],
    mtime: 0,
    ...extra,
  };
}

const quietTransport: Transport = {
  chat() {
    return Promise.reject(new AiError("auth", "should not be used in render tests"));
  },
};

function render<P extends object>(ui: FunctionComponent<P>, props: P): string {
  return renderToStaticMarkup(createElement<P>(ui, props));
}

describe("AskPanel (renderToString)", () => {
  it("shows the setup CTA and a disabled composer when AI isn't configured", () => {
    const html = render(AskPanel, {
      index: new MemoryIndex(),
      transport: quietTransport,
      aiConfigured: false,
      onOpenNote: () => undefined,
    });
    expect(html).toContain("Set up AI");
    expect(html).toContain("Ask anything about your world");
    // The composer input itself is gated on configuration.
    expect(html).not.toContain('placeholder="Ask your world');
  });

  it("enables the composer when AI is configured and hides the CTA", () => {
    const index = new MemoryIndex();
    index.upsert(note("a.md", "alpha content"));
    const html = render(AskPanel, {
      index,
      transport: quietTransport,
      aiConfigured: true,
      onOpenNote: () => undefined,
    });
    expect(html).not.toContain("Set up AI");
    const input = /<input[^>]*placeholder="Ask your world[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).not.toContain("disabled");
  });

  it("renders an empty-state hint and the ask header", () => {
    const html = render(AskPanel, {
      index: new MemoryIndex(),
      transport: quietTransport,
      aiConfigured: true,
      onOpenNote: () => undefined,
    });
    expect(html).toContain("wl-ask");
    expect(html).toContain("Ask anything about your world");
  });
});
