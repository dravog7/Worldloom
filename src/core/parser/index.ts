import { parseFrontmatter } from "./frontmatter";
import type { LinkRef, Note, Relation, Temporal } from "../types";

export type { LinkRef, Note, Relation, Temporal } from "../types";

/**
 * Parses one markdown note (frontmatter v1 + [[wikilinks]]) into a Note,
 * per ADR-002 (markdown is the source of truth).
 *
 * Tolerant by contract: malformed YAML frontmatter never throws — the note
 * is treated as frontmatter-less and the whole file becomes the body.
 */

const WIKILINK_RE = /\[\[([^[\]]*)\]\]/g;
const H1_RE = /^ {0,3}#(?!#)[ \t]+(.+)$/m;
const OPEN_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE_RE = /^ {0,3}(`+|~+)[ \t]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Frontmatter list field → trimmed, non-blank strings. Scalar → [scalar]. */
function stringList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }
  return [];
}

/** Typed edges from frontmatter `relations`; malformed entries are skipped. */
function parseRelations(value: unknown): Relation[] {
  if (!Array.isArray(value)) return [];
  const relations: Relation[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const { kind, target } = entry;
    if (typeof kind !== "string" || typeof target !== "string") continue;
    const trimmedKind = kind.trim();
    const trimmedTarget = target.trim();
    if (trimmedKind === "" || trimmedTarget === "") continue;
    relations.push({ kind: trimmedKind, target: trimmedTarget });
  }
  return relations;
}

/**
 * `temporal` era labels. ADR-002 shows `from`; the committed Temporal type
 * carries `from`/`to`, so the note-format alias `until` maps onto `to`.
 * Non-string values are dropped; an all-empty block yields undefined.
 */
function parseTemporal(value: unknown): Temporal | undefined {
  if (!isRecord(value)) return undefined;
  const from =
    typeof value.from === "string" ? value.from.trim() : undefined;
  const rawTo =
    typeof value.to === "string"
      ? value.to
      : typeof value.until === "string"
        ? value.until
        : undefined;
  const to = rawTo?.trim();
  const temporal: Temporal = {};
  if (from) temporal.from = from;
  if (to) temporal.to = to;
  return temporal.from !== undefined || temporal.to !== undefined
    ? temporal
    : undefined;
}

/**
 * Replaces fenced code blocks (``` / ~~~, CommonMark rules) with empty
 * lines so line numbering is preserved while their contents become invisible.
 */
function maskFencedCode(body: string): string {
  let openFence: { char: string; length: number } | null = null;
  const masked = body.split("\n").map((line) => {
    if (openFence !== null) {
      const close = CLOSE_FENCE_RE.exec(line);
      if (
        close !== null &&
        close[1][0] === openFence.char &&
        close[1].length >= openFence.length
      ) {
        openFence = null;
      }
      return "";
    }
    const open = OPEN_FENCE_RE.exec(line);
    if (open !== null) {
      const fence = open[1];
      const info = open[2];
      // A backtick fence's info string may not contain backticks (CommonMark).
      if (fence[0] === "`" && info.includes("`")) return line;
      openFence = { char: fence[0], length: fence.length };
      return "";
    }
    return line;
  });
  return masked.join("\n");
}

/** Blanks out inline code spans (`x`, ``x``) while preserving newlines. */
function maskInlineCode(text: string): string {
  return text.replace(/(`+)([\s\S]*?)\1/g, (match) =>
    match.replace(/[^\n]/g, " "),
  );
}

/** 0-based line number of `index` within `text`. */
function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length - 1;
}

/** Filename stem — identity fallback per ADR-002 ("Vael'Thor.md" → "Vael'Thor"). */
function filenameStem(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.md$/i, "") || base;
}

function extractLinks(
  maskedBody: string,
  source: string,
  lineOffset: number,
): LinkRef[] {
  const links: LinkRef[] = [];
  for (const match of maskedBody.matchAll(WIKILINK_RE)) {
    const inner = match[1];
    const pipe = inner.indexOf("|");
    const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    if (target === "") continue;
    const display =
      pipe === -1 ? undefined : inner.slice(pipe + 1).trim() || undefined;
    const line = lineOffset + lineOf(maskedBody, match.index ?? 0);
    links.push(
      display === undefined
        ? { source, target, line }
        : { source, target, line, display },
    );
  }
  return links;
}

/**
 * Parses one markdown note (frontmatter v1 + [[wikilinks]]) into a Note.
 *
 * Spec (PLAN-M1 B1): tolerant of malformed frontmatter (fall back to a
 * type-less note, never crash), pipe links [[x|y]] with 0-based line numbers
 * relative to the whole file, fenced-code-block and inline-code aware.
 */
export function parseNote(path: string, content: string, mtime = 0): Note {
  let data: Record<string, unknown> = {};
  let body = content;
  let lineOffset = 0;

  // Browser-safe v1 subset parser (see frontmatter.ts for WHY gray-matter
  // is gone: Buffer is externalized in WebView, silently dropping all
  // frontmatter in the real app). Returns null for absent/malformed.
  const parsed = parseFrontmatter(content);
  if (parsed !== null && isRecord(parsed.data)) {
    data = parsed.data;
    body = parsed.body;
    lineOffset = parsed.lineOffset;
  }

  const maskedBody = maskInlineCode(maskFencedCode(body));
  const title = H1_RE.exec(maskedBody)?.[1]?.trim() || filenameStem(path);
  const type =
    typeof data.type === "string" && data.type.trim() !== ""
      ? data.type.trim()
      : undefined;

  return {
    path,
    title,
    type,
    aliases: stringList(data.aliases),
    tags: stringList(data.tags),
    relations: parseRelations(data.relations),
    temporal: parseTemporal(data.temporal),
    body,
    links: extractLinks(maskedBody, path, lineOffset),
    mtime,
  };
}
