/**
 * Thin preview pane (PLAN-M1 C2): renders sanitized markdown and delegates
 * wikilink clicks to the parent. All parsing/sanitization lives in render.ts;
 * layout state lives in the parent — the toolbar here only reports choices.
 */
import { useMemo } from "react";
import type { MouseEvent } from "react";
import { renderMarkdown } from "./render";
import { LAYOUT_MODES } from "./layout";
import type { LayoutMode } from "./layout";
import "./preview.css";

export interface PreviewPaneProps {
  markdown: string;
  onNavigate: (target: string) => void;
}

export function PreviewPane({ markdown, onNavigate }: PreviewPaneProps) {
  const { html } = useMemo(() => renderMarkdown(markdown), [markdown]);

  // Click delegation: the HTML is sanitized, anchors carry data-wl-target.
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as Element).closest(".wl-link");
    const target = anchor?.getAttribute("data-wl-target");
    if (target === null || target === undefined) return;
    event.preventDefault();
    onNavigate(target);
  }

  return (
    <div
      className="wl-preview"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export interface PreviewToolbarProps {
  current: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
}

const LAYOUT_LABELS: Record<LayoutMode, string> = {
  split: "Split",
  "editor-only": "Editor",
  "preview-only": "Preview",
};

/** Reports layout choices up; the parent persists them. */
export function PreviewToolbar({ current, onLayoutChange }: PreviewToolbarProps) {
  return (
    <div className="wl-preview-toolbar" role="group" aria-label="Layout">
      {LAYOUT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className={
            mode === current ? "wl-layout-btn active" : "wl-layout-btn"
          }
          aria-pressed={mode === current}
          onClick={() => onLayoutChange(mode)}
        >
          {LAYOUT_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}
