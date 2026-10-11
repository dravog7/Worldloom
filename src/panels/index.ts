/**
 * File tree, backlinks panel, and Ctrl+K search palette (PLAN-M1 C3).
 * Pure logic (tree/search/backlinks) is exported alongside the thin React
 * components so the I1 store can drive state through the reducers directly.
 */

// Pure presentation/state logic.
export { flattenTree, toggleExpanded, parentPathOf } from "./tree";
export type { TreeNode, TreeRow } from "./tree";

export { searchReducer, initialSearchState, select } from "./search";
export type { SearchState, SearchAction } from "./search";

export { groupBacklinks } from "./backlinks";
export type { BacklinkGroup } from "./backlinks";

// Thin React components.
export { FileTree } from "./FileTree";
export type { FileTreeProps } from "./FileTree";

export { BacklinksPanel } from "./BacklinksPanel";
export type { BacklinksPanelProps } from "./BacklinksPanel";

export { SearchPalette } from "./SearchPalette";
export type { SearchPaletteProps } from "./SearchPalette";
