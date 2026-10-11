import { NotImplementedError } from "../errors";

/**
 * Generates markdown for a new stub note (frontmatter v1 template) so the
 * user can create a note for an unresolved wikilink target.
 *
 * Wave A stub — replaced by B3 (vault service).
 */
export function generateStubNote(title: string): string {
  void title;
  throw new NotImplementedError("generateStubNote");
}
