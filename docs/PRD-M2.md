# PRD — Worldloom M2 ("the continuity editor")

**Date:** 2026-10-12 · **Author:** Orchestrator (Hermes) · **Status:** draft — awaiting gate:m2
**Input:** PRD-M1 roadmap, ADR-004 (AI BYO spec), DISCOVERY-gm-workflows.md (51 sources), DISCOVERY-editor-models.md

## Vision (M2 = the money features)

The campaign world that audits itself. A GM with 50–2000 markdown notes can't re-read
them all; wikis "go stale somewhere in the first dozen sessions" [Saga20, Oct 2026].
M2 adds a BYO-key AI layer on top of the shipped M1 foundation (vault, index, live
editing, backlinks, search): **extraction proposals, a contradiction auditor with quoted
findings, and ask-your-world with citations.** Framing per discovery: a *continuity
editor*, not a writing assistant (MythScribe/Sudowrite own that).

## Target user

Same M1 persona (P1 committed homebrew GM). Discovery: BYO-key + "your lore never trains
anything" is the trust framing that matches AI-consent fears [reddit 1rd548j]. Non-dev
persona has never held an API key → provider presets + one-paste key + cost clarity.

## M2 scope

1. **AI settings**: provider preset (OpenAI / OpenRouter / OpenCode Zen / Ollama local /
   custom OpenAI-compatible), model, base URL, API key (OS keyring, never JSON), test
   connection, per-run token/cost visibility.
2. **Extraction** (per note, opt-in + queued): candidate entities/aliases/relations as
   proposals; **Accept** writes frontmatter + provenance comment
   `<!-- wl:extracted <date> confidence=… -->`; **Dismiss** = tombstone, never re-proposed.
3. **Auditor**:
   - *Rules pass* (deterministic, offline, free): duplicate alias → multiple targets,
     relation to missing note, temporal overlap conflicts.
   - *LLM pass* (on user action): narrative contradictions → findings
     `{quoteA, lineA, quoteB, lineB, explanation}`; findings link to both notes
     (click → open + reveal line, reusing M1.2 machinery). NEVER auto-edit.
     Accept = user-chosen edit; Dismiss = tombstone (finding hash), survives re-audit.
   - Incremental by mtime; full-vault audit only on explicit user action with a
     pre-run token/cost estimate.
4. **Ask** (chat over vault): retrieval via IndexProvider.search + backlinks of open
   note; answers must cite note paths; "not in your world" honesty rule.
5. **Offline behavior**: editing/search/backlinks never touch the network; AI features
   pause with a clear banner when no key/provider configured or offline.

## Explicitly OUT of M2 (locked)

Import wizard (Notion/Google Docs cleanup — candidate for M2.5, acquisition wedge,
defer until auditor ships), secrets/GM-visibility model (M3 player sharing), sync,
graph view, timelines, licensing/paywall, mobile, SQLite upgrade (scale gate not
tripped: MemoryIndex p95 < 50ms at 1k notes holds; 2k-note rebuild < 2s).

## Success criteria

- With a configured key: audit a 200-note vault end-to-end; every finding cites two
  exact quotes with working click-to-reveal; dismissed findings stay gone after re-audit.
- Rules pass runs offline in < 500ms on 2k notes.
- Extraction: 10-note sample → proposals in < 60s (queued), Accept produces valid
  frontmatter v1 that round-trips the M1 parser unchanged.
- Zero secrets on disk outside OS keyring; CSP unchanged; 234 existing tests stay green.
- Cost control: every vault-level LLM action shows an estimate before running.
