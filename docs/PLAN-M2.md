# PLAN — Worldloom M2 (waves; every task ≤4h, single output, TDD)

**Rules (same as M1):** each agent loads `great-cto-senior-dev` first. Pure logic
(src/core) gets vitest tests BEFORE implementation (red phase mandatory). No scope
beyond the task's "Done when". Windows paths, forward slashes, npm. All 234 existing
tests stay green; typecheck + lint clean after every wave. **Zero network in unit
tests** — AI transport is always the injected mock.

## Wave A — Rust plumbing (serial; blocks B+, tiny surface per ADR-006)

### A1 · keyring commands — agent A1
`src-tauri`: add `keyring` + `thiserror` deps; commands `key_set`, `key_get_status`,
`key_delete` (service `com.worldloom.app`, account `ai-api-key`); register in
lib.rs; capability entries. **Done when:** `npm run tauri dev` → settings-less smoke
script `scripts/smoke-keyring.mjs` sets/deletes a test key via invoke and status
flips; wrong-CSP-check: `tauri.conf.json` csp string byte-identical to M1.

### A2 · ai_chat proxy command — agent A2 (depends A1)
reqwest (rustls, json), scheme validation (https | http://127.0.0.1|localhost only),
120s timeout, 8MB response cap, no-redirect-to-other-scheme; command returns
`{content, usage, latency_ms}` or typed error (auth/http/timeout/invalid-response).
**Done when:** smoke against a local mock server (node script, committed under
scripts/) covers: happy path, 401→auth error, timeout→typed error, http://evil.com→
rejected before any socket; no key material ever in the response payload.

## Wave B — AI core (parallel after A1; pure TS)

### B1 · Transport + client — agent B1
`src/core/ai/transport.ts`: `Transport` iface `{chat(req): Promise<AiResponse>}`;
`client.ts`: OpenAI-completions request builder, typed error taxonomy, retry policy
(2 retries, backoff, only on 429/5xx), provider presets (OpenAI/OpenRouter/OpenCode
Zen/Ollama/custom) → {baseUrl, models[]}. **Done when:** vitest ≥14 cases with mock
transport (retry on 429, no retry on 400, preset resolution, abort/timeout path);
zero tauri imports.

### B2 · Prompts + structured extraction — agent B2
`src/core/ai/prompts/`: versioned prompt suite as data (extraction v1, audit v1, ask
v1); `extract.ts`: note → prompt → validated JSON proposal list
(entities/aliases/relations with confidence 0..1), strict parser (malformed model
JSON → typed error, never throws); token estimator (chars/4 + overhead). **Done when:**
vitest ≥12 cases: valid/malformed/oversized JSON, confidence clamp, dedupe against
existing frontmatter, estimator within ±25% of tiktoken-free heuristic on fixtures.

### B3 · Rules auditor (offline, deterministic) — agent B3
`src/core/audit/rules.ts`: given IndexProvider snapshot → findings[]: duplicate
alias→multiple targets, relation target missing note, temporal overlap conflicts,
dead wikilinks (bonus: already-shipped UX gap: links to nonexistent notes). Finding =
{id: content-hash, kind, noteA, lineA, quoteA, noteB?, lineB?, quoteB?, message}.
**Done when:** vitest ≥15 cases on fixture vault incl. hash stability (same finding →
same id), empty-vault, 2k-note synthetic < 500ms benchmark test.

## Wave C — Settings & capability UI (after A1/B1)

### C1 · AI settings panel — agent C1
Settings UI (provider preset dropdown, base URL, model, key paste→`key_set`,
test-connection button via ai_chat ping, price/1K table, cost-estimate preview);
store shape `aiSettings` (key NEVER in store JSON — status flag only). **Done when:**
vitest for preset/serialization logic (no key fields serialized — explicit test);
typecheck/lint clean; manual steps documented in panel (key lives in OS keyring).

### C2 · Offline banner + capability wiring — agent C2 (after C1)
`aiConfigured` selector → AI surfaces (Findings panel header, Ask box) show setup CTA
instead of controls; editing/search/backlinks provably network-free. **Done when:**
vitest for capability gating logic; app with no key → every AI entry point shows CTA,
zero invoke('ai_chat') calls recorded in a spy.

## Wave D — Auditor (after B3 + C2; the money feature)

### D1 · LLM audit pass — agent D1
`src/core/audit/llm.ts`: vault slice → contradiction findings (quote pairs with line
numbers), merge with rules findings, dedupe by hash, tombstone store
(`audit/<vaultHash>.json` in app data: dismissed + last-audit-stamp per note-mtime).
**Done when:** vitest ≥12 cases with mock transport (merge, tombstone suppresses
re-proposal, mtime invalidation re-audits only changed notes, malformed output → typed
error, never auto-writes vault — assert fs-port untouched).

### D2 · Findings panel — agent D2 (after D1)
Panel: grouped by note, severity order, each finding shows both quotes; click quote →
open note + reveal line (reuse M1.2 reveal machinery); Accept = "open at A" + "open at
B" (user edits; app never auto-edits); Dismiss = tombstone; "Run audit" button with
pre-run token/cost estimate + progress. **Done when:** vitest for grouping/sort/
estimate math; typecheck/lint clean; manual smoke checklist committed.

## Wave E — Extraction + Ask (after B2 + C2; parallel E1/E2)

### E1 · Extraction proposals — agent E1
Per-note "Extract entities" action → queued (2 notes/sec cap) proposal list inline in
a side drawer; Accept writes frontmatter (type/aliases/relations) + provenance
comment `<!-- wl:extracted <iso> confidence=… -->` via existing vault save (atomic);
Dismiss → tombstone hash, never re-proposed. **Done when:** vitest ≥10 cases (accept
rewrites frontmatter correctly, parser round-trip unchanged, tombstone suppression,
queue ordering); manual smoke.

### E2 · Ask panel — agent E2
Chat over vault: IndexProvider.search + backlinks(open note) → top-k context (token
budget ≤ 6k), answers must cite note paths (prompt-enforced + renderer linkifies
paths), "not in your world" honesty line when retrieval returns nothing; chat history
in-memory only. **Done when:** vitest for retrieval→context assembly, citation
extraction/linkification, empty-retrieval path; manual smoke.

## Integration & gates (orchestrator)

I1 · Wire store: aiSettings + findings store + extraction queue into App; cold-open.
I2 · Real smoke: fixture vault with seeded contradictions (≥5 known) → rules pass
finds structural ones offline; with key (or local Ollama if CTO has one) → LLM pass
finds ≥1 narrative one; dismiss → re-audit → suppressed.
I3 · Security review (great-cto-security-audit): key never in renderer/store/logs;
CSP byte-identical; scheme validation; no auto-edits; prompt-injection note (vault
content is untrusted input to prompts — documented + quoted-evidence-only UI).
I4 · Code review (great-cto-code-review) → done/blocked → **gate:ship to CTO (M2 dogfood)**.

Critical path: A1 → A2 → B1/B2/B3 → C1 → C2 → D1 → D2 / E1 / E2 → I1–I4.
Estimated total: ~12–16 agent-hours. M2.5 candidate (NOT in this plan): import wizard.
