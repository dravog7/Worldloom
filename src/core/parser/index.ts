import { NotImplementedError } from "../errors";
import type { Note } from "../types";

/**
 * Parses one markdown note (frontmatter v1 + [[wikilinks]]) into a Note.
 *
 * Spec (PLAN-M1 B1): tolerant of malformed frontmatter (fall back to a
 * type-less note, never crash), pipe links [[x|y]] with line numbers,
 * backtick-code-block aware.
 *
 * Wave A stub — replaced by B1.
 */
export function parseNote(path: string, content: string): Note {
  void path;
  void content;
  throw new NotImplementedError("parseNote");
}
