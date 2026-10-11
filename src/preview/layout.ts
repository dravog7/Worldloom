/**
 * Preview/editor layout modes and the toggle cycle (PLAN-M1 C2). The parent
 * owns persistence; it validates restored settings with `isLayoutMode` and
 * applies changes reported by the PreviewPane toolbar.
 */

export const LAYOUT_MODES = ["split", "editor-only", "preview-only"] as const;

export type LayoutMode = (typeof LAYOUT_MODES)[number];

/** split → editor-only → preview-only → split. */
export function nextLayout(current: LayoutMode): LayoutMode {
  const index = LAYOUT_MODES.indexOf(current);
  return LAYOUT_MODES[(index + 1) % LAYOUT_MODES.length];
}

/** Type guard for values read back from persisted settings. */
export function isLayoutMode(value: string): value is LayoutMode {
  return (LAYOUT_MODES as readonly string[]).includes(value);
}
