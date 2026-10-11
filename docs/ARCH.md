# ARCH — Worldloom M1

**Date:** 2026-10-11 · Status: awaiting gate:arch

## Problem

Worldbuilders lose years of lore in wikis they fear abandoning or prose tools that own
their data. Worldloom keeps lore as plain markdown on disk (portable, git-able) and adds
the structure layer (typed links, index, later AI audit) as a lightweight desktop app.

## Components

```
┌──────────────────── Tauri v2 shell (Rust, plugin-only, no custom commands in M1) ──┐
│  plugins: fs · dialog · watcher · store                                            │
└───────────────┬────────────────────────────────────────────────────────────────────┘
                │ typed TS bindings (@tauri-apps/api)
┌───────────────▼────────────────────────────────────────────────────────────────────┐
│  Renderer (React18 + TS + Vite, system WebView2)                                   │
│                                                                                    │
│  src/core (PURE TS — zero tauri imports, fully unit-testable headless)             │
│    ├── parser    frontmatter (gray-matter) + [[wikilinks]]/aliases extraction      │
│    ├── vault     path↔note model, stub generation, atomic save                     │
│    └── index     IndexProvider iface → MemoryIndex + JsonPersist + InvertedIndex   │
│                                                                                    │
│  src/app        zustand store; tauri adapters (fs/dialog/watcher → core events)    │
│  src/editor     CodeMirror 6 (markdown + [[ autocompletion wired to IndexProvider) │
│  src/preview    markdown-it + DOMPurify (split/toggle)                             │
│  src/panels     file tree · backlinks · search                                     │
└────────────────────────────────────────────────────────────────────────────────────┘
        derived index JSON lives in app-data dir, NEVER in the vault (rebuild-safe)
```

## Data flow

watcher event / save → debounce(150ms) → parser.parse → index.upsert/remove →
zustand notify → panels (backlinks/search/tree) re-render. Vault writes: temp-file +
rename (atomic), then watcher confirms.

## Data model

- Note: path, title (first H1 or filename), type?, aliases[], tags[], relations[{kind,target}],
  body, links[], mtime.
- Edge (derived, M1): src→dst from wikilinks (untyped). Frontmatter `relations` = typed edges.
- Index JSON: {notes, edges, token→paths inverted map} in
  `%APPDATA%/worldloom/index/<vaultHash>.json`; delete = full rebuild (safe).

## Security

Local-first: **zero network code in M1** (verifiable: no fetch/axios shipped). Renderer
CSP locked (no remote scripts), contextIsolation, no nodeIntegration. M2 keys go to OS
keyring (tauri-plugin-stronghold/keyring), never JSON. Vault content never leaves disk M1/M2
except explicit AI calls (M2, user-initiated BYO key).

## Lightweight targets (hard requirement, CTO)

- Installer ≤ 15MB (Tauri+WebView2-exists) vs Electron ~100MB+.
- Idle RAM < 200MB (target <100MB on typical vault).
- Cold start < 3s on dev machine; no bundled Chromium.

## Cost estimate

Infra: ₹0 (local-first, no servers). LLM (M2): user BYO key (~₹0–500/mo casual).
Build cost: agent-hours only. Distribution: free OSS core possible; license paywall M3.

## Well-Architected (6 pillars, brief)

Operational: no ops by design. Security: CSP/isolation/no-network-M1/keyring-M2.
Reliability: atomic writes; index rebuild-safe; autosave never loses >150ms of typing.
Performance: targets above; search O(tokens) in-memory. Cost: ₹0 infra.
Sustainability: markdown portability = user exit story (builds trust); TS-only surface
except thin Tauri shell.

## Pre-mortem (top 3 risks)

1. **Windows watcher flakiness / feedback loops** (save triggers watcher triggers index…) →
   mitigation: ignore self-writes (hash compare), debounce, test on 2k-file fixture.
2. **Autosave corruption** → atomic temp+rename, never truncate-then-write, crash test.
3. **Scope creep toward "build Obsidian"** → PRD out-list is binding; anything new = new PRD row.

## Failure modes

Vault unreadable (permissions) → clear error + retry, never blank window. Corrupt index
JSON → detected by version stamp + hash, auto-rebuild silently. Malformed frontmatter →
parser tolerant (fall back to type-less note), never crash the tree.
