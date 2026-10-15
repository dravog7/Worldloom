/**
 * W2 word-style toolbar row: a thin presentational layer over the frozen
 * ToolbarState / ToolbarAction contract (toolbar.ts). No CM6, no view, no
 * local state — the parent owns both. Buttons swallow `mousedown` so
 * clicking never steals the editor selection; active toggles light up via
 * `wl-md-btn-active` when the caret sits inside that construct.
 */
import type { JSX } from "react";
import type { BlockStyle, ToolbarAction, ToolbarState } from "./toolbar";
import "./toolbar.css";

export interface ToolbarRowProps {
  state: ToolbarState;
  onAction: (action: ToolbarAction) => void;
}

const STYLE_OPTIONS: { value: BlockStyle; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
];

const TOGGLES: {
  action: ToolbarAction;
  label: string;
  title: string;
  flag?: keyof ToolbarState["inline"];
}[] = [
  { action: "bold", label: "B", title: "Bold", flag: "bold" },
  { action: "italic", label: "I", title: "Italic", flag: "italic" },
  { action: "strike", label: "S", title: "Strikethrough", flag: "strike" },
  { action: "underline", label: "U", title: "Underline", flag: "underline" },
  { action: "code", label: "</>", title: "Inline code", flag: "code" },
  { action: "bullet", label: "•", title: "Bulleted list" },
  { action: "numbered", label: "1.", title: "Numbered list" },
  { action: "quote", label: "❝", title: "Quote" },
  { action: "wikilink", label: "[[", title: "Wikilink" },
  { action: "indent", label: "→", title: "Indent" },
  { action: "outdent", label: "←", title: "Outdent" },
];

export function ToolbarRow({ state, onAction }: ToolbarRowProps): JSX.Element {
  return (
    <div className="wl-md-toolbar" role="toolbar" aria-label="Formatting">
      <select
        className="wl-md-style-select"
        aria-label="Text style"
        value={state.block}
        onChange={(e) => onAction(e.target.value as ToolbarAction)}
      >
        {STYLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {TOGGLES.map((button) => {
        const active = button.flag !== undefined && state.inline[button.flag];
        return (
          <button
            key={button.action}
            type="button"
            title={button.title}
            aria-label={button.title}
            className={
              active
                ? `wl-md-btn wl-md-btn-${button.action} wl-md-btn-active`
                : `wl-md-btn wl-md-btn-${button.action}`
            }
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onAction(button.action)}
          >
            {button.label}
          </button>
        );
      })}
    </div>
  );
}
