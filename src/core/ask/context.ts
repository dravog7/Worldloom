/**
 * M2 Wave E2 — ask-context assembly (PLAN-M2 E2, PRD-M2 §4).
 *
 * Pure retrieval → prompt-context: IndexProvider.search hits for the question
 * (top 5), the backlink sources of the open note (top 5), and the open note
 * itself, deduped by path and rendered with 0-based line numbers so every
 * citation in an answer is checkable against the excerpt it came from.
 *
 * Honesty floor (PRD-M2 §4): when retrieval finds NOTHING relevant — no
 * search hit with score > 0 and no open note — the result is `{empty: true}`
 * and the caller MUST answer locally without calling the LLM. This module is
 * the code-enforced half of the "not in your world" rule; the prompt-side
 * half lives in the frozen ask-v1 text.
 *
 * Token budget (PLAN-M2: ≤ 6k): sources are admitted in priority order
 * (search hits by score → backlink sources → open note). A source that does
 * not fit is line-trimmed to the remaining budget; once a source cannot even
 * start (header + one line), admission stops. The first source is never
 * dropped whole — a non-empty result always carries real excerpt content.
 */
import { estimateTokens } from "../ai/extract";
import type { AskContextItem } from "../ai/prompts";
import type { IndexProvider } from "../index/provider";
import type { LinkRef, Note, SearchHit } from "../types";

/** Token estimator contract; defaults to extract.ts's estimateTokens. */
export type TokenEstimator = (text: string) => number;

/** Default context budget (PLAN-M2: ≤ 6k tokens per ask). */
export const DEFAULT_ASK_CONTEXT_TOKENS = 6_000;

/** Top-k retrieval knobs (PLAN-M2 E2). */
export const MAX_SEARCH_HITS = 5;
export const MAX_BACKLINK_SOURCES = 5;
/** Lines of a backlink source kept on each side of the incoming link. */
export const BACKLINK_WINDOW_LINES = 2;

export interface BuildAskContextOptions {
  /** Hard cap on the assembled context; default 6k estimator tokens. */
  maxTokens?: number;
  estimator?: TokenEstimator;
}

/**
 * Discriminated result: `{empty: true}` is the honesty-floor signal — the
 * question matched nothing in the world and the caller must reply locally.
 */
export type AskContextResult =
  | { empty: true; context: ""; sources: readonly string[] }
  | { empty: false; context: string; sources: readonly string[] };

/** One numbered body line. */
interface NumberedLine {
  line: number;
  text: string;
}

/** One assembled source (already deduped by path). */
interface SourceEntry {
  path: string;
  title: string;
  lines: NumberedLine[];
}

/** Numbered lines of a note body (0-based, empty lines kept for numbering). */
function numberLines(body: string): NumberedLine[] {
  return body.split("\n").map((text, line) => ({ line, text }));
}

/** `## <title> (path)` header, per the PLAN-M2 E2 context format. */
function headerOf(entry: SourceEntry): string {
  return `## ${entry.title} (${entry.path})`;
}

/** Excerpt body: `0: text` per line — 0-based, citation-checkable. */
function renderExcerpt(lines: readonly NumberedLine[]): string {
  return lines.map((entry) => `${entry.line}: ${entry.text}`).join("\n");
}

/** Full fragment as it appears in the joined context string. */
function renderFragment(entry: SourceEntry): string {
  return `${headerOf(entry)}\n${renderExcerpt(entry.lines)}`;
}

interface Assembly {
  entries: SourceEntry[];
  /** Search hits that scored above zero, top-k, in rank order. */
  searchable: SearchHit[];
  openNotePresent: boolean;
}

/**
 * Single assembly pass. Priority: search hits (score order) → backlink
 * sources (source path, then line) → the open note. First occurrence of a
 * path wins its slot; later mentions merge their lines into it.
 */
function assemble(
  index: IndexProvider,
  question: string,
  openNotePath?: string,
): Assembly {
  const notesByPath = new Map(index.all().map((note) => [note.path, note]));
  const openNote = openNotePath !== undefined ? notesByPath.get(openNotePath) : undefined;

  const searchable = index
    .search(question)
    .filter((hit) => hit.score > 0)
    .slice(0, MAX_SEARCH_HITS);

  const entries: SourceEntry[] = [];
  const byPath = new Map<string, SourceEntry>();
  const add = (note: Note, lines: NumberedLine[]): void => {
    const existing = byPath.get(note.path);
    if (existing) {
      // Merge (dedupe by path): keep line order, drop duplicate line numbers.
      const seen = new Set(existing.lines.map((entry) => entry.line));
      for (const entry of lines) {
        if (!seen.has(entry.line)) {
          existing.lines.push(entry);
          seen.add(entry.line);
        }
      }
      existing.lines.sort((a, b) => a.line - b.line);
      return;
    }
    const created: SourceEntry = { path: note.path, title: note.title, lines: [...lines] };
    byPath.set(note.path, created);
    entries.push(created);
  };

  // 1) Search hits — the question's most relevant notes, full bodies.
  for (const hit of searchable) {
    const note = notesByPath.get(hit.path);
    if (note) add(note, numberLines(note.body));
  }

  // 2) Backlink sources of the open note — a window around each incoming link.
  if (openNotePath !== undefined) {
    const refs = [...index.backlinks(openNotePath)].sort(
      (a: LinkRef, b: LinkRef) => a.source.localeCompare(b.source) || a.line - b.line,
    );
    const windowsByPath = new Map<string, Map<number, string>>();
    for (const ref of refs.slice(0, MAX_BACKLINK_SOURCES)) {
      const note = notesByPath.get(ref.source);
      if (!note) continue;
      let window = windowsByPath.get(note.path);
      if (!window) {
        window = new Map();
        windowsByPath.set(note.path, window);
      }
      const body = note.body.split("\n");
      const start = Math.max(0, ref.line - BACKLINK_WINDOW_LINES);
      const end = Math.min(body.length - 1, ref.line + BACKLINK_WINDOW_LINES);
      for (let line = start; line <= end; line += 1) {
        window.set(line, body[line] ?? "");
      }
    }
    for (const [path, window] of windowsByPath) {
      const note = notesByPath.get(path);
      if (!note) continue;
      const lines = [...window.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([line, text]) => ({ line, text }));
      add(note, lines);
    }
  }

  // 3) The open note itself (already merged if it was a hit).
  if (openNote) add(openNote, numberLines(openNote.body));

  return { entries, searchable, openNotePresent: openNote !== undefined };
}

/**
 * Admits entries under the token budget. A source that does not fit whole is
 * line-trimmed to the remainder; once a source cannot even start (header +
 * one line), admission stops. The FIRST source is admitted whole even over
 * budget — a non-empty result always carries content.
 */
function admit(
  entries: readonly SourceEntry[],
  budget: number,
  estimator: TokenEstimator,
): SourceEntry[] {
  const admitted: SourceEntry[] = [];
  let used = 0;
  for (const entry of entries) {
    const cost = estimator(renderFragment(entry));
    if (used + cost <= budget) {
      admitted.push(entry);
      used += cost;
      continue;
    }
    const trimmed = trimToTokens(entry, budget - used, estimator);
    if (trimmed !== null) {
      admitted.push(trimmed);
      break; // this entry consumed the remainder; nothing after it can fit
    }
    if (admitted.length === 0) {
      // Not even a minimal slice fits — keep the first source whole anyway.
      admitted.push(entry);
    }
    break;
  }
  return admitted;
}

/**
 * Shrinks one entry to `maxTokens`, keeping the header and the leading lines.
 * Returns the entry itself when it already fits, `null` when not even
 * header + one line fits.
 */
function trimToTokens(
  entry: SourceEntry,
  maxTokens: number,
  estimator: TokenEstimator,
): SourceEntry | null {
  if (estimator(renderFragment(entry)) <= maxTokens) return entry;
  let keep = 0;
  for (const line of entry.lines) {
    const candidate = `${headerOf(entry)}\n${renderExcerpt([
      ...entry.lines.slice(0, keep),
      line,
    ])}`;
    if (estimator(candidate) > maxTokens) break;
    keep += 1;
  }
  if (keep === 0) return null; // not even header + one line fits
  return { ...entry, lines: entry.lines.slice(0, keep) };
}

function build(
  index: IndexProvider,
  question: string,
  openNotePath?: string,
  options: BuildAskContextOptions = {},
): { empty: boolean; items: AskContextItem[]; sources: string[]; context: string } {
  const estimator = options.estimator ?? estimateTokens;
  const budget =
    options.maxTokens !== undefined &&
    Number.isFinite(options.maxTokens) &&
    options.maxTokens > 0
      ? options.maxTokens
      : DEFAULT_ASK_CONTEXT_TOKENS;

  const { entries, searchable, openNotePresent } = assemble(index, question, openNotePath);

  // Honesty floor (PRD-M2 §4): nothing scored above zero AND no open note.
  if (searchable.length === 0 && !openNotePresent) {
    return { empty: true, items: [], sources: [], context: "" };
  }

  const admitted = admit(entries, budget, estimator);
  const items: AskContextItem[] = admitted.map((entry) => ({
    path: entry.path,
    excerpt: renderExcerpt(entry.lines),
  }));
  const context = admitted.map(renderFragment).join("\n\n");
  return { empty: false, items, sources: admitted.map((entry) => entry.path), context };
}

/**
 * Assembled ask context: `{empty: true}` on the honesty floor, otherwise the
 * joined `## <title> (path)` blocks plus the source paths (citation-strip
 * chips) in inclusion order.
 */
export function buildAskContext(
  index: IndexProvider,
  question: string,
  openNotePath?: string,
  options: BuildAskContextOptions = {},
): AskContextResult {
  const built = build(index, question, openNotePath, options);
  return built.empty
    ? { empty: true, context: "", sources: [] }
    : { empty: false, context: built.context, sources: built.sources };
}

/**
 * Prompt-ready items for the frozen ask-v1 prompt (`[[path]]` + excerpt);
 * empty array on the honesty floor — callers must not send an empty-context
 * request to the model.
 */
export function buildAskContextItems(
  index: IndexProvider,
  question: string,
  openNotePath?: string,
  options: BuildAskContextOptions = {},
): AskContextItem[] {
  return build(index, question, openNotePath, options).items;
}
