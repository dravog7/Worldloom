import type { JSX } from "react";
import type { BacklinkGroup } from "./backlinks";
import "./panels.css";

/**
 * Backlinks panel (PLAN-M1 C3). Thin view over groupBacklinks output:
 * groups are pre-sorted (source path; links by line), a click on a link
 * asks the parent to open that source note and scroll to the line.
 */
export interface BacklinksPanelProps {
  groups: BacklinkGroup[];
  onOpen(path: string, line: number): void;
}

export function BacklinksPanel(props: BacklinksPanelProps): JSX.Element {
  const total = props.groups.reduce((sum, group) => sum + group.links.length, 0);
  return (
    <section className="wl-panel wl-backlinks" aria-label="Backlinks">
      <header className="wl-panel-header">
        Backlinks <span className="wl-count">{total}</span>
      </header>
      {props.groups.length === 0 && <p className="wl-empty">No backlinks yet.</p>}
      {props.groups.map((group) => (
        <div key={group.path} className="wl-backlink-group">
          <div className="wl-backlink-source" title={group.path}>
            {group.path}
          </div>
          {group.links.map((link, index) => (
            <button
              key={`${link.line}-${index}`}
              type="button"
              className="wl-backlink-item"
              onClick={() => props.onOpen(link.source, link.line)}
            >
              <span className="wl-backlink-line">:{link.line + 1}</span>
              <span className="wl-backlink-text">{link.display ?? link.target}</span>
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}
