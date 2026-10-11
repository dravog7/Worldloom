/**
 * Preview pane (PLAN-M1 C2): markdown-it render + wikilink rule, DOMPurify
 * sanitization, thin React pane + toolbar, layout mode helpers.
 */
export { renderMarkdown, sanitizeHtml, setSanitizerWindowForTests } from "./render";
export type { RenderOptions, RenderResult, WikilinkRef } from "./render";
export { LAYOUT_MODES, isLayoutMode, nextLayout } from "./layout";
export type { LayoutMode } from "./layout";
export { PreviewPane, PreviewToolbar } from "./PreviewPane";
export type { PreviewPaneProps, PreviewToolbarProps } from "./PreviewPane";
