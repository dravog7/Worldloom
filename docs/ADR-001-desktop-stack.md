# ADR-001 — Desktop stack: Tauri v2 (lightweight requirement)

**Date:** 2026-10-11 · **Status:** proposed (gate:arch)

## Context

CTO hard requirement: **lightweight desktop app**. Earlier draft assumed Electron; rejected
under that requirement. Users are GMs on laptops (often aging); a 100MB+ Chromium bundle
and 300MB idle RAM contradicts the product promise.

## Options

| Option | Installer | Idle RAM | Dev surface | Risk |
|---|---|---|---|---|
| **Tauri v2** ✅ | ~5–15MB | ~30–80MB | React/TS (his stack) + thin plugin-config Rust | Rust MSRV; Windows build toolchain |
| Electron | ~80–120MB | ~200–400MB | All TS/Node | Fails lightweight requirement |
| Neutralino.js | ~2MB | ~50MB | JS only | Small ecosystem; watcher/store plugins immature |
| Local server + browser | tiny | low | TS | Not a real desktop app; folder-permission UX clumsy |

## Decision

**Tauri v2**, plugins-only shell (fs, dialog, watcher, store) — **no custom Rust commands
in M1**; all logic in TS/React. Toolchain: Rust exists at 1.76 (below Tauri v2 MSRV 1.77.2)
→ Wave A step 0 = `rustup update stable` (verify ≥ MSRV, then scaffold).
WebView2 runtime present (Win11); MSVC build tools present (VS Build Tools v143).

## Consequences

- Fast/light app; system WebView2 rendering (consistent on Win11).
- Agents write only TS/React for features → low AI-agent risk surface.
- M2+ may add a few Rust commands (e.g. bulk file ops) — isolated, reviewable.
- If Tauri Windows build proves hostile, fallback = Electron (re-litigate ADR, cost ~½ day).
