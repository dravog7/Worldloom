/**
 * Content hash used by the self-write-suppression journal (ARCH.md pre-mortem
 * risk #1: watcher feedback loops). Two independent FNV-1a rounds (offset
 * basis + prime variants) folded into a 64-bit hex string — pure TS, zero
 * dependencies; collision risk is irrelevant for change detection of
 * file-sized inputs.
 */
export function contentHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9dc5811c;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
    h2 ^= h2 >>> 13;
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}
