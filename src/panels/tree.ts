/**
 * File-tree presentation logic (PLAN-M1 C3). Pure functions only — the
 * FileTree component renders whatever flattenTree returns, and all expansion
 * state lives with the parent (zustand store in I1), never inside the tree.
 */

/** A node in the vault file tree (dirs may nest arbitrarily). */
export interface TreeNode {
  name: string;
  /** Vault-relative path, forward slashes, no trailing slash. */
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

/** One visible row produced by flattenTree. */
export interface TreeRow {
  path: string;
  name: string;
  isDirectory: boolean;
  /** Indent level: 0 for root entries, +1 per ancestor directory. */
  depth: number;
  /** Directories only: true when this row's children are currently shown. */
  expanded: boolean;
}

/**
 * Flattens the tree into visible rows, depth-first, document order (a
 * directory row is always immediately followed by its shown children).
 *
 * - No filter: children of a directory are shown only if the expanded set
 *   contains its path.
 * - Non-empty filter: the expanded set is ignored and a subtree is kept iff
 *   its own name or any descendant's name contains the query
 *   (case-insensitive substring), so ancestors of a match stay visible
 *   regardless of collapse state.
 */
export function flattenTree(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  filter = "",
): TreeRow[] {
  const query = filter.trim().toLowerCase();
  const selfMatches = (node: TreeNode): boolean =>
    query === "" || node.name.toLowerCase().includes(query);
  /** Kept iff this node matches or any descendant does (ancestor retention). */
  const kept = (node: TreeNode): boolean =>
    selfMatches(node) || (node.children ?? []).some(kept);

  const rows: TreeRow[] = [];
  const walk = (node: TreeNode, depth: number): void => {
    const children = node.children ?? [];
    const childKept = node.isDirectory && children.some(kept);
    const showChildren =
      node.isDirectory && children.length > 0 && (query !== "" ? childKept : expanded.has(node.path));
    if (!selfMatches(node) && !childKept) return;
    rows.push({
      path: node.path,
      name: node.name,
      isDirectory: node.isDirectory,
      depth,
      expanded: showChildren,
    });
    if (showChildren) for (const child of children) walk(child, depth + 1);
  };
  for (const node of nodes) walk(node, 0);
  return rows;
}

/**
 * Toggle-expansion reducer: returns a NEW set with `path` added or removed.
 * Never mutates the input (React state must stay replace-only).
 */
export function toggleExpanded(expanded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(expanded);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** Vault-relative directory containing `path` ("" for root-level entries). */
export function parentPathOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}
