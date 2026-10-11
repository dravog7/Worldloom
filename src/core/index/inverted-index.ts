/**
 * Token inverted index (ADR-003): token → set of note paths.
 *
 * Tokenizer contract (PLAN-M1 B2): lowercase, split on non-word characters,
 * Unicode letters and digits kept — "Väles" and "lohikäärme" survive as
 * single tokens (\p{L}\p{N}, no ASCII-only \w).
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const EMPTY: ReadonlySet<string> = new Set();

export class InvertedIndex {
  private readonly postings = new Map<string, Set<string>>();
  private readonly docTokens = new Map<string, Set<string>>();

  /** Indexes a document, replacing any previous tokens for the same path. */
  add(path: string, tokens: string[]): void {
    this.remove(path);
    const unique = new Set(tokens);
    this.docTokens.set(path, unique);
    for (const token of unique) {
      let posting = this.postings.get(token);
      if (!posting) {
        posting = new Set();
        this.postings.set(token, posting);
      }
      posting.add(path);
    }
  }

  /** Drops a document from every posting list. Idempotent. */
  remove(path: string): void {
    const tokens = this.docTokens.get(path);
    if (!tokens) return;
    this.docTokens.delete(path);
    for (const token of tokens) {
      const posting = this.postings.get(token);
      if (!posting) continue;
      posting.delete(path);
      if (posting.size === 0) this.postings.delete(token);
    }
  }

  /** Paths whose document contains the token (exact, already lowercased). */
  pathsFor(token: string): ReadonlySet<string> {
    return this.postings.get(token) ?? EMPTY;
  }

  tokensOf(path: string): ReadonlySet<string> {
    return this.docTokens.get(path) ?? EMPTY;
  }
}
