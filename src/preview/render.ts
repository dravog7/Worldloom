/**
 * Pure markdown → sanitized-HTML renderer for the preview pane (PLAN-M1 C2).
 *
 * - markdown-it runs with `html: false`: raw HTML in the markdown source is
 *   escaped as literal text, never interpreted.
 * - A custom inline rule turns `[[Target]]` / `[[Target|display]]` into
 *   `<a class="wl-link" data-wl-target="Target" href="#">display</a>`
 *   anchors. The href is always "#" — real navigation is wired by the pane
 *   via click delegation, never by the renderer.
 * - The rendered output is sanitized with DOMPurify using an explicit window
 *   (JSDOM-injected in tests, the WebView2 global at runtime) and then run
 *   through an href allowlist: only "#", http(s): and mailto: survive;
 *   anything else (javascript:, data:, relative paths) collapses to "#".
 */
import MarkdownIt from "markdown-it";
import type { StateInline } from "markdown-it";
import DOMPurify from "dompurify";
import type { Config, WindowLike } from "dompurify";

/** One rendered wikilink, in source order. */
export interface WikilinkRef {
  target: string;
  display: string;
}

export interface RenderResult {
  html: string;
  links: WikilinkRef[];
}

export interface RenderOptions {
  /** Reserved: navigation is wired by PreviewPane click delegation, not here. */
  onNavigateHint?: never;
}

/** DOMPurify hardening: forbid the risky containers, keep our link attrs. */
const PURIFY_CONFIG: Config = {
  FORBID_TAGS: ["style", "iframe", "object", "embed"],
  // class and data-* are already in DOMPurify's default allowlist; listing
  // data-wl-target explicitly keeps our contract visible and pinned.
  ALLOW_DATA_ATTR: true,
  ADD_ATTR: ["data-wl-target"],
};

/** Href schemes the preview may emit: fragments, web, and email. */
const ALLOWED_HREF = /^(?:#|https?:\/\/|mailto:)/i;

/**
 * Test-only escape hatch: vitest runs in the node environment (no DOM), so
 * tests hand the renderer a JSDOM window. At runtime this stays unset and
 * the WebView2 global window is used.
 */
let injectedWindow: WindowLike | undefined;

export function setSanitizerWindowForTests(window?: WindowLike): void {
  injectedWindow = window;
}

function resolveWindow(): WindowLike {
  if (injectedWindow) return injectedWindow;
  const runtime =
    typeof globalThis.window !== "undefined"
      ? (globalThis.window as unknown as WindowLike)
      : undefined;
  // Never fall through to DOMPurify's no-DOM path: it would return the input
  // unsanitized. Fail loudly instead.
  if (runtime === undefined || !DOMPurify.isSupported) {
    throw new Error(
      "renderMarkdown requires a DOM: run inside WebView2, or call " +
        "setSanitizerWindowForTests(new JSDOM('').window) in tests.",
    );
  }
  return runtime;
}

/**
 * Second gate after DOMPurify: every href must be "#", http(s): or mailto:,
 * otherwise it is rewritten to "#".
 */
function enforceHrefAllowlist(doc: Document): void {
  for (const element of doc.querySelectorAll("[href]")) {
    const href = (element.getAttribute("href") ?? "").trim();
    if (!ALLOWED_HREF.test(href)) element.setAttribute("href", "#");
  }
}

/**
 * Sanitizes an HTML fragment: DOMPurify (explicit window) + href allowlist.
 * Exported because it is a useful unit on its own and is directly tested.
 */
export function sanitizeHtml(html: string): string {
  const win = resolveWindow();
  const purify = injectedWindow ? DOMPurify(injectedWindow) : DOMPurify;
  const clean = purify.sanitize(html, PURIFY_CONFIG);
  const doc = new win.DOMParser().parseFromString(clean, "text/html");
  enforceHrefAllowlist(doc);
  return doc.body.innerHTML;
}

const OPEN_BRACKET = 0x5b; // "["

/**
 * Inline rule for `[[Target]]` and `[[Target|display]]`. The display text is
 * plain text (markdown inside it is not parsed), matching src/core/parser.
 * Found wikilinks are recorded in `state.env.wlLinks` in source order.
 */
function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== OPEN_BRACKET || src.charCodeAt(pos + 1) !== OPEN_BRACKET) {
    return false;
  }
  const end = src.indexOf("]]", pos + 2);
  if (end === -1) return false;
  const inner = src.slice(pos + 2, end);
  if (inner.includes("\n")) return false;

  const pipe = inner.indexOf("|");
  const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  if (target === "") return false;
  const display = (pipe === -1 ? target : inner.slice(pipe + 1).trim()) || target;

  if (!silent) {
    const open = state.push("link_open", "a", 1);
    open.attrs = [
      ["class", "wl-link"],
      ["data-wl-target", target],
      ["href", "#"],
    ];
    const text = state.push("text", "", 0);
    text.content = display;
    state.push("link_close", "a", -1);

    const env = state.env as { wlLinks?: WikilinkRef[] } | null | undefined;
    env?.wlLinks?.push({ target, display });
  }
  state.pos = end + 2;
  return true;
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
md.inline.ruler.before("link", "wikilink", wikilinkRule);

/**
 * Renders markdown to sanitized preview HTML plus the wikilink targets in
 * source order (for the pane to wire click → internal navigation).
 */
export function renderMarkdown(
  markdown: string,
  opts?: RenderOptions,
): RenderResult {
  void opts; // reserved nav-hint channel; navigation is click-delegated
  const env: { wlLinks: WikilinkRef[] } = { wlLinks: [] };
  const rawHtml = md.render(markdown, env);
  return { html: sanitizeHtml(rawHtml), links: env.wlLinks };
}
