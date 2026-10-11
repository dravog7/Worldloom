# ADR-003 — Index & search: in-memory TS first, SQLite only on a scale trigger

**Date:** 2026-10-11 · **Status:** proposed (gate:arch)

## Decision

M1 ships an **IndexProvider interface** with one implementation: `MemoryIndex`
(notes map, edge list, alias map, token inverted index) persisted to a JSON sidecar in
app data (`index/<vaultHash>.json`, version-stamped). Search = inverted-index intersect
+ fuzzy title/alias rank. **No SQLite, no native modules in M1.**

Upgrade gate to `SqliteFts5Index` (via tauri-plugin-sql) trips only if measured:
search p95 > 150ms or index JSON > 25MB (≈ 5k+ notes) on the dev machine.

## Why

- Native modules (better-sqlite3-style) add build weight and agent failure modes —
  against the lightweight requirement for zero demonstrated need at 50–2000 notes.
- Pure-TS index = headless unit tests with no Tauri runtime (fastest agent iteration).
- Interface keeps M2 auditor and M3 graph consuming the same contract either way.

## Interface (contract for all agents)

```ts
interface IndexProvider {
  upsert(note: Note): void
  remove(path: string): void
  byTitleOrAlias(q: string): Note[]      // fuzzy; feeds [[autocomplete]]
  backlinks(path: string): LinkRef[]
  links(path: string): LinkRef[]
  search(query: string): SearchHit[]     // tokens + phrase boost
  all(): Note[]
  persist(): Promise<void>; load(): Promise<void>
}
```

## Consequences

Rebuild = reparse vault (target <2s for 2k notes; measured in Wave B tests).
JSON sidecar is disposable state, documented as such.
