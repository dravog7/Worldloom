import type { JSX, KeyboardEvent } from "react";
import type { SearchHit } from "../core/types";
import "./panels.css";

/**
 * Ctrl+K search palette (PLAN-M1 C3). Thin controlled component: it only
 * renders the parent-held SearchState and forwards keystrokes/choices —
 * the palette reducer (search.ts) owns query/hits/cursor, and the Ctrl+K
 * binding itself lives at the PARENT level (I1 store wires the keydown).
 * Enter selects the highlighted hit; Escape closes.
 */
export interface SearchPaletteProps {
  open: boolean;
  query: string;
  hits: SearchHit[];
  /** Index into hits; -1 = nothing highlighted. */
  cursor: number;
  onQuery(query: string): void;
  onMove(delta: number): void;
  onSelect(hit: SearchHit): void;
  onClose(): void;
}

export function SearchPalette(props: SearchPaletteProps): JSX.Element | null {
  if (!props.open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        props.onMove(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        props.onMove(-1);
        break;
      case "Enter": {
        const hit = props.hits[props.cursor];
        if (hit) props.onSelect(hit);
        break;
      }
      case "Escape":
        event.preventDefault();
        props.onClose();
        break;
    }
  };

  return (
    <div className="wl-palette-overlay" onClick={props.onClose}>
      <div
        className="wl-panel wl-search-palette"
        role="dialog"
        aria-label="Search"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          className="wl-palette-input"
          type="text"
          autoFocus
          placeholder="Search notes…"
          aria-label="Search notes"
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="wl-palette-results" role="listbox" aria-label="Search results">
          {props.query !== "" && props.hits.length === 0 && (
            <li className="wl-empty">No results.</li>
          )}
          {props.hits.map((hit, index) => (
            <li
              key={hit.path}
              role="option"
              aria-selected={index === props.cursor}
              className={index === props.cursor ? "wl-palette-hit wl-palette-hit-active" : "wl-palette-hit"}
              onClick={() => props.onSelect(hit)}
            >
              <span className="wl-palette-title">{hit.title}</span>
              <span className="wl-palette-path">{hit.path}</span>
              {hit.snippet !== undefined && <span className="wl-palette-snippet">{hit.snippet}</span>}
            </li>
          ))}
        </ul>
        <footer className="wl-palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </footer>
      </div>
    </div>
  );
}
