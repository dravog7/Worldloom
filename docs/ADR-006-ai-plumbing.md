# ADR-006 — AI plumbing: Rust-side proxy + OS keyring, renderer holds no secrets

**Date:** 2026-10-12 · **Status:** accepted (gate:m2 approved 2026-10-13) · Supersedes the "plugin-only, no
custom Rust commands" constraint of ADR-001 (which was scoped to M1)

## Context

ADR-004 fixed the product decisions (BYO key, OpenAI-compatible endpoint, prompts
versioned in repo, never auto-edit). M2 must decide *how requests physically travel*
without breaking M1's security posture: CSP is locked (`connect-src 'self' ipc:
http://ipc.localhost`) and must stay locked — arbitrary renderer `fetch` to LLM
providers would both widen CSP and put the API key in renderer memory/JS heap where a
compromised WebView could exfiltrate it.

## Decision

1. **All AI network egress goes through one custom Tauri command** `ai_chat` (Rust):
   renderer sends `{ base_url, model, messages, temperature, max_tokens }`; Rust reads
   the API key from the OS keyring, injects it, performs the HTTPS request (reqwest),
   returns `{ content, usage, latency_ms }`. The key **never enters the renderer** and
   CSP is untouched.
2. **Key storage: `keyring` crate** (Windows Credential Manager / macOS Keychain /
   SecretService), NOT tauri-plugin-stronghold — Stronghold ships a wasmi VM + vault
   machinery for what is one OS-native secret per app; against the lightweight
   requirement. Commands: `key_set` / `key_get_status` (bool: present, never the value)
   / `key_delete`.
3. **Transport validation in Rust**: only `https:` (or `http://127.0.0.1`/`localhost`
   for Ollama) accepted; request timeout 120s; response size cap 8MB; no redirects to
   non-allowlisted schemes.
4. **Renderer AI client stays pure TS** (`src/core/ai/`) with an injected
   `Transport` interface; the Tauri adapter implements Transport via `invoke('ai_chat')`;
   tests inject a mock transport. Zero network in unit tests (same discipline as M1).
5. **Offline/no-key = degraded, never blocked**: every AI surface checks a capability
   flag from the store (`aiConfigured`) and shows a setup banner; editing never waits
   on network.

## Consequences

- One small Rust surface (~150 lines + tests-by-smoke) instead of plugin sprawl.
- A user-supplied base_url is a user-controlled outbound host — mitigated by scheme
  validation + explicit per-run UI (audits are user-triggered, never automatic).
- Provider presets (OpenAI/OpenRouter/OpenCode Zen/Ollama/custom) live in TS and only
  choose base_url + model; the wire protocol is OpenAI chat-completions everywhere.
- Cost estimate = tokens/4 × user-visible $/1K table (editable; local models = free).
