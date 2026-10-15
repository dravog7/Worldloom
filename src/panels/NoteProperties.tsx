/**
 * W4 (CTO-approved editor rework) — read-only "Note properties" popover.
 *
 * The YAML frontmatter block is hidden in the live view (W1 replaces it with
 * a chip widget that dispatches `wl-open-properties`); this popover is what
 * the chip opens. Read-only by design for now: frontmatter stays an internal
 * storage form (ADR-002 + the editor-rework decision) — editing properties
 * belongs to the extraction Accept flow and future M-later work, not here.
 */
import type { JSX } from "react";
import type { Note } from "../core/types";

export interface NotePropertiesProps {
  open: boolean;
  note: Note | null;
  onClose: () => void;
}

/** One `key: value` row; arrays render comma-joined, empties render as `—`. */
function Row({ label, value }: { label: string; value: string | undefined | string[] }): JSX.Element {
  const text = Array.isArray(value)
    ? value.join(", ")
    : (value ?? "");
  return (
    <div className="wl-props-row">
      <span className="wl-props-key">{label}</span>
      <span className={text ? "wl-props-val" : "wl-props-val wl-props-empty"}>
        {text || "—"}
      </span>
    </div>
  );
}

export function NoteProperties({ open, note, onClose }: NotePropertiesProps): JSX.Element | null {
  if (!open || !note) return null;
  return (
    <div className="wl-props-popover" role="dialog" aria-label="Note properties">
      <div className="wl-props-head">
        <strong>Note properties</strong>
        <button
          type="button"
          className="wl-btn wl-btn-ghost"
          onClick={onClose}
          aria-label="Close properties"
        >
          ✕
        </button>
      </div>
      <Row label="File" value={note.path} />
      <Row label="Title" value={note.title} />
      <Row label="Type" value={note.type} />
      <Row label="Aliases" value={note.aliases} />
      <Row label="Tags" value={note.tags} />
      <p className="wl-props-foot muted">
        Stored as YAML in the file; invisible while you write.
      </p>
    </div>
  );
}
