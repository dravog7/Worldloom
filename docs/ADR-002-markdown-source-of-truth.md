# ADR-002 — Markdown files are the source of truth

**Date:** 2026-10-11 · **Status:** proposed (gate:arch)

## Decision

The vault = an ordinary folder of `.md` files. The app NEVER stores lore in a database;
databases hold only derived indexes that can be deleted and rebuilt at any moment.

## Note format (v1)

```markdown
---
type: character            # character|place|event|faction|item|concept|campaign|session (free string, extensible)
aliases: [Aelindra, The Exile]
tags: [royalty, act1]
relations:
  - kind: born_in
    target: Vael'Thor
temporal:
  from: "Age of Ash"        # free-form era label in M1; parsed dates in M3 time-slider
---

Aelindra slipped into [[Vael'Thor]] on the night of the coronation,
though [[Coronation of Halden]] had declared her dead.
```

- Wikilinks: `[[Note Title]]` or `[[Note Title|display text]]` (Obsidian-compatible syntax
  so existing vaults import cleanly).
- Untyped edges = wikilinks (from body). Typed edges = frontmatter `relations`.
- AI-proposed facts (M2) are written INTO these files with a provenance comment —
  the file stays readable and complete without the app.

## Why

1. Trust story vs competitors: files you can grep, git, zip, and abandon — the anti-lock-in pitch.
2. Obsidian-vault import becomes trivial (same syntax).
3. Corruption surface shrinks to a rebuildable index.
4. Diff-ability enables M3 collaboration/git workflows for free.

## Consequences

- Concurrency = last-writer-wins (acceptable solo; file mtime guards in index).
- No cross-note transactions (acceptable: index derived).
- Filename = identity for paths; title/aliases resolve display names (alias map in index).
