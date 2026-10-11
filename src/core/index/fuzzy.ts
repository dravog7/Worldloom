/**
 * Fuzzy name matching for [[autocomplete]] (PLAN-M1 B2):
 * exact > prefix > ordered subsequence. Both query and name are expected
 * lowercased by the caller.
 */
export type MatchTier = 0 | 1 | 2;

/** True when every character of `needle` appears in `haystack` in order. */
export function subsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) return true;
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

/** Best match tier of `query` against one name, or -1 for no match. */
export function nameMatchTier(query: string, name: string): MatchTier | -1 {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (subsequence(query, name)) return 2;
  return -1;
}
