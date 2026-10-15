/**
 * Wikilink completion source (PLAN-M1 C1).
 *
 * Deliberately CodeMirror-free: the factory takes an injected lookup and
 * returns a function over a *structural* subset of CM6's `CompletionContext`
 * (`state.doc.sliceString` + `pos`), producing a structural `CompletionResult`
 * (`{from, to, options}`). That keeps the logic unit-testable in vitest's
 * plain-Node environment while the result stays directly passable to
 * `autocompletion({ override: [source] })` in the editor component.
 */

/** One autocomplete candidate — the fields the editor needs from a note. */
export interface CompletionCandidate {
  /** Note title; the accepted text is always `[[Title]]` (ADR-002 form). */
  title: string;
  /** Vault-relative path, surfaced as the option detail. */
  path: string;
  /** Alias names that may have matched the query. */
  aliases: string[];
}

/** Injected fuzzy lookup — in the app this is `MemoryIndex.byTitleOrAlias`. */
export type WikilinkLookup = (query: string) => CompletionCandidate[];

/** Structural slice of @codemirror/state's `Text` this module relies on. */
export interface ReadableDoc {
  readonly length: number;
  sliceString(from: number, to?: number): string;
}

export interface ReadableState {
  readonly doc: ReadableDoc;
}

/** Structural subset of CM6's `CompletionContext`. */
export interface CompletionProbe {
  readonly state: ReadableState;
  readonly pos: number;
}

export interface WikilinkOption {
  /** Note title — also the visible label. */
  label: string;
  /** Vault-relative path shown next to the label. */
  detail?: string;
  /** Text that replaces `[from, to)` when the option is accepted. */
  apply: string;
}

export interface WikilinkCompletionResult {
  /** Start of the opening `[[` — the replaced span swallows the brackets. */
  from: number;
  /** Cursor position — the end of the partial span. */
  to: number;
  options: WikilinkOption[];
  /**
   * Always `false`: CodeMirror must NOT re-filter these options against the
   * raw `from..to` text. That span deliberately includes the literal `[[`
   * (so applying `[[Title]]` does not stack brackets), but CM6's completion
   * dialog fuzzy-matches each option label against that same span — and no
   * note title contains `[`, so every option would be discarded and the
   * tooltip would never open (the wikilink-completion-UI bug). Filtering
   * and ranking are the injected lookup's job (exact > prefix >
   * subsequence), which is also what `filter: false` opts into.
   */
  filter: false;
}

/** CM6-compatible source shape: `null` means "no completions here". */
export type WikilinkCompletionSource = (
  context: CompletionProbe,
) => WikilinkCompletionResult | null;

/**
 * Trigger: an unclosed `[[` followed by a partial title containing no
 * brackets, at the end of the current line.
 */
const WIKILINK_TRIGGER = /\[\[([^[\]]*)$/u;

/**
 * Builds a `[[`-completion source over an injected lookup.
 *
 * - No unclosed `[[` before the cursor (current line only) → `null`.
 * - The partial title is passed verbatim to `lookup`, which owns ranking
 *   (MemoryIndex.byTitleOrAlias: exact > prefix > subsequence).
 * - Candidates keep lookup order; duplicate titles are dropped.
 * - Accepting an option replaces the partial span with `[[Title]]`.
 */
export function createWikilinkCompletionSource(
  lookup: WikilinkLookup,
): WikilinkCompletionSource {
  return (context) => {
    const { pos } = context;
    const before = context.state.doc.sliceString(0, pos);
    // Wikilinks never span lines — restrict the trigger to the current line.
    const lineStart = before.lastIndexOf("\n") + 1;
    const match = WIKILINK_TRIGGER.exec(before.slice(lineStart));
    if (match === null) return null;

    const partial = match[1];
    const options: WikilinkOption[] = [];
    const seen = new Set<string>();
    for (const candidate of lookup(partial)) {
      if (seen.has(candidate.title)) continue;
      seen.add(candidate.title);
      options.push({
        label: candidate.title,
        detail: candidate.path,
        apply: `[[${candidate.title}]]`,
      });
    }
    // The replaced span includes the opening "[[" so that applying
    // `[[Title]]` does not stack brackets; `filter: false` keeps CM6 from
    // fuzzy-matching that bracket-inclusive span against the labels (see
    // WikilinkCompletionResult.filter).
    return { from: pos - partial.length - 2, to: pos, options, filter: false };
  };
}
