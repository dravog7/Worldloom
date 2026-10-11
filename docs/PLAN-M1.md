# PLAN — Worldloom M1 (waves; every task ≤4h, single output, TDD)

**Rules:** each agent loads `great-cto-senior-dev` first. Pure logic (src/core) gets vitest
tests written BEFORE implementation (red phase mandatory). No scope beyond the task's
"Done when". Paths: Windows, forward slashes. Package manager: npm.

## Wave A — scaffold (serial, blocks everything)

### A0 · Toolchain gate (orchestrator, not an agent)
`rustup update stable`; verify `cargo -V` ≥ 1.77.2 (Tauri v2 MSRV). If update impossible →
escalate to CTO (stack fallback per ADR-001).

### A1 · Tauri+React+TS scaffold — agent A
`npm create tauri-app@latest` (react-ts template) in Worldloom root; add vitest, eslint,
zustand, gray-matter, markdown-it, dompurify, @codemirror/*; folder layout per ARCH
(src/core|app|editor|preview|panels, fixtures/vault-sample with ≥30 interconnected notes).
Scripts: `dev`, `test`, `lint`, `typecheck`.
**Done when:** `npm run tauri dev` opens window (blank app shell OK); `npm test` runs 1
passing sample test; `npm run typecheck && npm run lint` clean; fixture vault exists.

## Wave B — core (parallel agents B1/B2/B3 after A1)

### B1 · Parser — agent B1 (pure TS, no tauri imports)
src/core/parser: parseNote(path, content) → {frontmatter v1 schema, title, aliases, wikilinks
[[x|y]] with line numbers, backtick-code-block-aware}. Tolerant of malformed frontmatter.
**Done when:** vitest ≥12 cases (valid/invalid frontmatter, aliases forms, links in code
blocks ignored, pipe links, unicode titles) all green; zero tauri imports (enforced by
eslint import restriction in A1 config).

### B2 · Index — agent B2 (pure TS, depends on B1 types only)
src/core/index per ADR-003 interface: MemoryIndex, fuzzy byTitleOrAlias (prefix + subsequence
rank), inverted search, JSON persist/load with version+vaultHash stamp, auto-rebuild on
mismatch. **Done when:** vitest ≥15 cases incl. persist→load roundtrip, corrupt-JSON→rebuild,
1k-note synthetic index p95 search <50ms benchmark test; interface matches ADR-003 exactly.

### B3 · Vault service + tauri adapters — agent B3 (depends on A1, uses B1/B2 interfaces
via dependency injection, NOT imports of their impls)
src/app/vault: open-folder dialog, recursive scan (skip .git/node_modules), watcher wiring
with debounce(150ms)+self-write suppression, atomic save (temp+rename), stub-note creation.
**Done when:** vitest for pure parts (debounce/self-write/atomic-write logic with mocked fs);
manual smoke script `npm run smoke -- fixtures/vault-sample` lists notes + simulates
watch events; no real Tauri calls outside src/app/adapters.

## Wave C — UI (parallel agents C1/C2/C3 after B1/B2 land)

### C1 · Editor pane — agent C1
CM6 markdown, autosave debounce 800ms → vault.save, `[[` autocompletion source querying
IndexProvider (titles+aliases), status indicator (saving/saved). **Done when:** type in
editor → file on disk updates once per pause; `[[al` shows fuzzy list; selecting inserts
`[[Title]]`; vitest for the autocompletion source (mocked index).

### C2 · Preview pane — agent C2
markdown-it render with wikilink rule → internal nav event; DOMPurify sanitize; split/toggle
layout persisted in settings. **Done when:** vitest for renderer (wikilinks → data-path attrs,
HTML sanitized: script/img-onerror stripped); side-by-side layout toggles and restores.

### C3 · Panels — agent C3
File tree (create/rename/delete context menu), backlinks panel (click → open+scroll-to-line),
search palette (Ctrl+K, keyboard nav). **Done when:** tree reflects watcher events live;
backlinks list correct vs fixture expectations (vitest with mocked index); search palette
opens/filters/opens-hit (vitest for filter logic).

## Integration & gates (orchestrator)

I1 · Wire store: zustand vault/index singletons → panels; cold-open fixture vault.
I2 · Real-vault smoke: copy of a small real notes folder (CTO-provided or fixture) — full
loop: edit → search → backlink → stub-create → restart app → state intact (index rebuilt).
I3 · Code review (great-cto-code-review rubric) + security pass (no network imports, no
secrets, CSP intact) → done/blocked verdict → **gate:ship to CTO for M1 dogfooding**.

Critical path: A0 → A1 → (B1,B2) → C1/C2/C3 → I1 → I2 → I3. Estimated total: ~10–14 agent-hours.
