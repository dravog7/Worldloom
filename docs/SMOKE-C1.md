# SMOKE — M2 Wave C1 · AI settings surface

Manual checklist for the AI settings modal (PRD-M2 §1). Run inside the desktop
shell — `npm run tauri dev` with a vault open (the keyring and the settings
store need Tauri; plain `vite` shows "key status unavailable" by design).

## Open & layout

- [ ] 1. **Open Settings** — click **AI settings** in the header, right of the
      Live/Source toggle. The modal opens; Escape or clicking the backdrop
      closes it; the Ctrl+K palette still works independently.

## Provider preset → fields

- [ ] 2. **Preset fills fields** — choose *OpenRouter*: Base URL becomes
      `https://openrouter.ai/api/v1`, Model fills `openai/gpt-4o-mini`
      (the model input's datalist suggests the preset's models).
- [ ] 3. **Base URL validation** — type `http://example.com/v1`: red inline
      "Must be https (http only for localhost)." and the value does not commit
      (switch preset away and back — the URL returns to the preset value).
      `https://…` and `http://127.0.0.1:11434/v1` (Ollama) are accepted.

## Key → OS keyring

- [ ] 4. **Save key, status flips** — paste a key, click **Save key**: green
      "key stored in OS keyring", the key field clears immediately, and the
      indicator flips grey "○ no key" → green "● key present".
- [ ] 5. **Key never re-populated** — close and reopen the modal: the field is
      empty (placeholder "paste to replace stored key"), indicator still green.
- [ ] 6. **On disk** — Windows Credential Manager has a generic credential
      `com.worldloom.app` / `ai-api-key`; `worldloom-settings.json` contains
      ONLY `vaultPath`, `layout`, `aiSettings` — grep it for the key: no match.
- [ ] 7. **No key → test disabled** — devtools:
      `window.__TAURI_INTERNALS__.invoke('key_delete')`, reopen Settings:
      grey "○ no key", **Test connection** disabled with the hint to store a
      key first.

## Test connection

- [ ] 8. **Happy path** — key present + valid Base URL + model → **Test
      connection** → green "Connected — \<model\> replied: …".
      (Until Wave A2 commits `ai_chat`, the button reports
      "ai_chat not available" — expected; see the TODO in
      `src/app/adapters/ai-key.ts`.)
- [ ] 9. **Bad key** — store a wrong key → red auth error message from the
      Rust proxy, no crash.
- [ ] 10. **Ollama** — preset *Ollama (local)*: API key labeled
      "(local provider — not needed)", **Test connection** enabled with just
      the loopback Base URL and no key.

## Cost table

- [ ] 11. **Preview math** — set Input $/1M = 1 → hint reads "Example: a
      hypothetical 10,000-token input costs ≈ 0.0100 USD at 1 / 1M."
- [ ] 12. **Persistence** — preset/URL/model/prices survive an app restart;
      the note line reads "Your API key is stored in the OS keyring and never
      touches app files."
