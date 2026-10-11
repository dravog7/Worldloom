# ADR-004 — AI layer: BYO key, provider-agnostic, offline-first (M2 spec, no M1 code)

**Date:** 2026-10-11 · **Status:** spec-only (M1 ships zero network code)

## Decision

AI features (M2) call an **OpenAI-compatible endpoint** (baseURL + apiKey + model in
settings; works with OpenRouter, OpenCode Zen, local Ollama). Key stored in OS keyring
(tauri-plugin-stronghold), never JSON, never telemetry. App is fully functional offline
in M1 and degraded-functional offline in M2 (auditor/ask pause, editing never blocks).

## M2 pipeline (design now, build later)

1. **Extract** (per saved note): prompt returns candidate entities/aliases/relations as JSON;
   shown as inline proposals; Accept writes frontmatter + provenance comment
   `<!-- wl:extracted 2026-11-01 confidence=0.82 -->`; Dismiss writes tombstone to
   suppress re-proposal.
2. **Audit** (vault-level, background queue, incremental by mtime): rules pass (deterministic:
   same alias→two targets, relation to missing note, temporal overlap conflicts) + LLM pass
   (narrative contradictions). Findings = {quoteA, quoteB, explanation}; NEVER auto-edit;
   Accept = user-chosen edit; Dismiss = tombstone (hash of finding).
3. **Ask** (chat over vault): retrieve top-k notes via IndexProvider.search + backlinks of
   open note; answers must cite note paths; "not in your world" honesty rule (MythScribe parity).

## Cost/limits

Per-note extraction capped (e.g. 2 notes/sec queue), audit full-vault only on user action.
Model-agnostic: prompt suite versioned in repo (src/core/ai/prompts/).
