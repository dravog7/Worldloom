# PRD — Worldloom M1 (working name, rename before public)

**Date:** 2026-10-11 · **Author:** Orchestrator (Hermes) · **Approved by:** CTO (pending gate:arch)

## Vision (from discovery, Business/GOOD_ENOUGH_ANALYSIS.md + verified competitive map)

A **desktop worldbase editor**: markdown files on disk are the world; the app adds
typed links, search, backlinks — and (M2) an AI auditor that finds contradictions.
Positioning after Oct 2026 verification: **"the campaign world that audits itself"**
for TTRPG GMs / worldbuilders / indie narrative designers. Not a novel-writing tool
(MythScribe, Sudowrite own that), not a template wiki (World Anvil owns that).

## Target user (M1)

Solo TTRPG game master with a folder of campaign notes (or an Obsidian vault),
50–2000 markdown files, who wants structure without giving up file ownership.

## M1 scope — "foundation vertical slice"

1. Open a folder as a vault; folder of `.md` files is the ONLY source of truth.
2. Sidebar file tree, live (create/rename/delete reflected without restart).
3. Editor pane: markdown editing, autosave (debounced, atomic write), no formatting chrome.
4. `[[Wikilink]]` syntax: autocomplete as you type (titles + aliases, fuzzy), unresolved
   links clickable → creates a stub note with minimal frontmatter.
5. Backlinks panel for the open note.
6. Full-vault search (title, alias, body) — local, instant, no AI.
7. Live preview pane (toggle/split), sanitized HTML.
8. Frontmatter schema (v1): `type`, `aliases`, `tags`, `relations`, `temporal` (see ADR-002).
9. Lightweight hard requirement: small installer, low RAM, fast startup (targets in ARCH).

## Explicitly OUT of M1 (locked to prevent Obsidian-scope-creep)

Graph view, AI anything (no network code ships in M1), maps, timelines UI, collaboration,
sync, plugins, themes marketplace, licensing/paywall, mobile.

## Roadmap

- **M2 — the money features:** BYO-key AI layer: entity/edge extraction proposals,
  contradiction auditor with quoted findings, ask-your-world with citations; import wizard
  for existing vaults. Index upgrade to SQLite/FTS5 only if scale gate trips (ADR-003).
- **M3 — face & business:** graph view (typed, filterable, time slider), export
  (JSON/game-engine-friendly), one-time licensing (Paddle/Lemon Squeezy), pre-sell landing.

## Success criteria

M1 done when: sample vault (fixtures/vault-sample, ≥30 notes) opens, edit → search finds
it in <150ms, backlinks correct, all vitest green, `npm run tauri dev` cold-starts <3s
on the dev machine, app idle RAM <200MB. M2 validation gate (external): pre-sell page
gets 3–5 paying intents before licensing work starts.
