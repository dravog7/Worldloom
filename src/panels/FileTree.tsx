import type { JSX, MouseEvent } from "react";
import { useState } from "react";
import { flattenTree, parentPathOf, type TreeNode } from "./tree";
import "./panels.css";

/**
 * File tree (PLAN-M1 C3). Thin view: flattens `tree` via the pure
 * flattenTree and forwards every interaction to props — expansion state,
 * watcher-driven tree updates and all mutations live in the parent (I1
 * store → VaultService). Context menu is local UI state only.
 */
export interface FileTreeProps {
  tree: TreeNode[];
  expanded: ReadonlySet<string>;
  /** Case-insensitive name filter; ancestors of matches stay visible. */
  filter: string;
  onOpen(path: string): void;
  onToggle(path: string): void;
  /** Create a new note inside `parentPath` ("" = vault root). */
  onCreate(parentPath: string): void;
  onRename(path: string): void;
  onDelete(path: string): void;
}

interface MenuState {
  x: number;
  y: number;
  path: string;
  isDirectory: boolean;
}

export function FileTree(props: FileTreeProps): JSX.Element {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const rows = flattenTree(props.tree, props.expanded, props.filter);

  const openMenu = (event: MouseEvent, path: string, isDirectory: boolean): void => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, path, isDirectory });
  };

  const closeMenu = (): void => setMenu(null);

  const act = (fn: () => void): void => {
    fn();
    closeMenu();
  };

  return (
    <div className="wl-panel wl-file-tree" role="tree" aria-label="Vault files">
      {rows.length === 0 && <p className="wl-empty">No files match.</p>}
      {rows.map((row) => (
        <div
          key={row.path}
          className="wl-tree-row"
          role="treeitem"
          aria-selected={false}
          aria-expanded={row.isDirectory ? row.expanded : undefined}
          style={{ paddingLeft: `${8 + row.depth * 14}px` }}
          onClick={() => (row.isDirectory ? props.onToggle(row.path) : props.onOpen(row.path))}
          onContextMenu={(event) => openMenu(event, row.path, row.isDirectory)}
        >
          <span className={row.isDirectory ? "wl-icon-dir" : "wl-icon-file"} aria-hidden="true">
            {row.isDirectory ? "▸" : "•"}
          </span>
          <span className="wl-tree-name">{row.name}</span>
        </div>
      ))}
      {menu !== null && (
        <>
          <div className="wl-menu-backdrop" onClick={closeMenu} aria-hidden="true" />
          <div
            className="wl-context-menu"
            role="menu"
            style={{ left: `${menu.x}px`, top: `${menu.y}px` }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                act(() => props.onCreate(menu.isDirectory ? menu.path : parentPathOf(menu.path)))
              }
            >
              New note here
            </button>
            <button type="button" role="menuitem" onClick={() => act(() => props.onRename(menu.path))}>
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className="wl-danger"
              onClick={() => act(() => props.onDelete(menu.path))}
            >
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
