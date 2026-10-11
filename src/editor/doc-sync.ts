/**
 * Doc-sync decision (PLAN-M1 C1): when may the editor adopt externally
 * provided content (e.g. a watcher echo or a fresh note load)?
 *
 * Extracted from EditorPane so the rule is unit-testable in plain Node.
 */

/**
 * @param currentPath  Note the editor currently shows.
 * @param currentDoc   Full text currently in the editor for `currentPath`.
 * @param dirty        True while unsaved local edits exist for `currentPath`.
 * @param nextPath     Note the new `content` belongs to.
 * @param nextContent  Externally provided content.
 * @returns true when the editor doc should be replaced wholesale.
 */
export function shouldReplaceDoc(
  currentPath: string,
  currentDoc: string,
  dirty: boolean,
  nextPath: string,
  nextContent: string,
): boolean {
  // Switching notes always adopts the new note's content.
  if (nextPath !== currentPath) return true;
  // Never clobber unsaved local edits with an external echo.
  if (dirty) return false;
  // Clean editor + differing external content (watcher/external edit) → adopt.
  return nextContent !== currentDoc;
}
