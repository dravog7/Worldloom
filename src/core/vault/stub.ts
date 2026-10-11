/**
 * Stub-note generation (PLAN-M1 B3): filename slug + minimal frontmatter v1
 * per ADR-002 (type unset, aliases: [title]) + a single H1 body, so the stub
 * is immediately resolvable for future links and greppable on disk.
 */

/** Characters unsafe in filenames or that would corrupt the wikilink syntax. */
const UNSAFE_CHARS = /[\\/:*?"<>|#^[\]`]/g;
/** YAML scalars containing these characters must be quoted to survive parsing. */
const YAML_UNSAFE_ANYWHERE = /[:,#[\]{}&*!"|]/;
/** Characters that are only special at the start of a plain scalar. */
const YAML_UNSAFE_LEADING = /^[-?:,[\]{}#&*!|>'"%@`]/;

/**
 * Slugifies a wikilink target into a safe vault filename (no extension).
 * Apostrophes, spaces and unicode survive (fixture convention:
 * "Siege of Vael'Thor.md"); only unsafe characters are stripped.
 */
export function slugifyFileName(title: string): string {
  const cleaned = title
    .replace(UNSAFE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : "Untitled";
}

/** YAML scalar for a frontmatter value: plain unless quoting is required. */
function yamlScalar(value: string): string {
  const needsQuote =
    YAML_UNSAFE_ANYWHERE.test(value) ||
    YAML_UNSAFE_LEADING.test(value) ||
    value !== value.trim() ||
    value === "";
  if (needsQuote) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * Markdown for a new stub note (frontmatter v1 template) so the user can
 * create a note for an unresolved wikilink target.
 */
export function generateStubNote(title: string): string {
  const singleLine = title.replace(/[\r\n]+/g, " ").trim();
  return `---\naliases: [${yamlScalar(singleLine)}]\n---\n\n# ${singleLine}\n`;
}
