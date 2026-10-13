/**
 * M2 Wave E2 — citation extraction and answer rendering (PLAN-M2 E2).
 *
 * The ask prompt mandates [[wikilink]] citations to note paths; this module
 * is the mechanical half: it scans an answer for KNOWN vault paths (exact
 * match only — a path is never guessed out of partial words) with an
 * optional `:line` suffix, and renders the answer markdown-lite with those
 * mentions linkified as `<a data-path data-line>` anchors. Line numbers are
 * passed through exactly as written (context excerpts number lines 0-based,
 * so model citations stay 0-based too).
 *
 * Trust boundary: the answer text is untrusted MODEL output and note paths
 * may contain hostile characters. `renderAnswer` escapes everything first
 * and only then inserts its own anchor markup, so the output is safe by
 * construction — no raw character from the input ever reaches the HTML.
 */

/** One citation found in an answer: a known path, optional literal line. */
export interface AskCitation {
  path: string;
  /** Line exactly as written in the answer (context lines are 0-based). */
  line?: number;
}

/** Escape the five HTML-significant characters (order matters: & first). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Citation scanner for one path set. Guards:
 * - the match may not be preceded by a word/path char (so `Note.md` never
 *   fires inside `Other/Note.md` or `PrefixedNote.md`);
 * - a `:line` suffix must be colon + digits + boundary; `path:12abc` fires
 *   nothing at all rather than silently dropping the line;
 * - longer paths win over their suffixes (alternation is length-sorted).
 */
function citeRegex(paths: readonly string[]): RegExp {
  const alts = [...new Set(paths)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  return new RegExp(
    `(?<![\\w/\\\\._"'>-])(${alts.join("|")})(?::(\\d+))?(?!\\w|:\\d)`,
    "g",
  );
}

/**
 * Extracts citations (known paths, optional `:line`) from answer text.
 * Unknown paths are ignored; exact repeats (same path + line) are deduped,
 * first occurrence wins. Malformed input yields [] rather than throwing.
 */
export function extractCitations(
  answerText: string,
  knownPaths: readonly string[],
): AskCitation[] {
  if (typeof answerText !== "string" || knownPaths.length === 0) return [];
  const citations: AskCitation[] = [];
  const seen = new Set<string>();
  for (const match of answerText.matchAll(citeRegex(knownPaths))) {
    const path = match[1] as string;
    const lineText = match[2];
    const key = lineText === undefined ? path : `${path}:${lineText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(
      lineText === undefined ? { path } : { path, line: Number(lineText) },
    );
  }
  return citations;
}

/**
 * Unwraps `[[path]]` / `[[path:line]]` around KNOWN (escaped) paths so the
 * bare-path pass can linkify them uniformly. Unknown wikilinks stay literal.
 */
function stripKnownWikilinks(text: string, knownEscaped: ReadonlySet<string>): string {
  return text.replace(/\[\[([^\]\n]+)\]\]/g, (whole, inner: string) => {
    const candidate = inner.trim();
    if (knownEscaped.has(candidate)) return candidate;
    const suffixed = /^(.*?)(:\d+)$/.exec(candidate);
    if (suffixed && knownEscaped.has(suffixed[1] as string)) return candidate;
    return whole;
  });
}

/**
 * Renders an answer markdown-lite: every known-path mention becomes
 * `<a class="wl-cite" data-path="…" data-line="…?" href="#">`; everything
 * else passes through HTML-escaped. The panel click-delegates on
 * `a[data-path]` and never uses href for navigation.
 */
export function renderAnswer(
  answerText: string,
  knownPaths: readonly string[],
): string {
  if (typeof answerText !== "string") return "";
  const escaped = escapeHtml(answerText);
  if (knownPaths.length === 0) return escaped;

  // The scanner runs in escaped space, so paths are matched in escaped form.
  const escapedPaths = [...new Set(knownPaths.map(escapeHtml))];
  const escapedSet = new Set(escapedPaths);
  const stripped = stripKnownWikilinks(escaped, escapedSet);

  return stripped.replace(
    citeRegex(escapedPaths),
    (whole, escPath: string, lineText: string | undefined) => {
      if (!escapedSet.has(escPath)) return whole;
      const lineAttr = lineText === undefined ? "" : ` data-line="${lineText}"`;
      return `<a class="wl-cite" data-path="${escPath}"${lineAttr} href="#">${whole}</a>`;
    },
  );
}
