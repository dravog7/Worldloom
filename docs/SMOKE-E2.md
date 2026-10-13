# SMOKE — M2 Wave E2 · Ask panel (chat over the vault)

Manual checklist for the Ask panel (PLAN-M2 E2, PRD-M2 §4). Run inside the
desktop shell — `npm run tauri dev` with a vault open. Steps 1–4 work with
Ollama (local, no key); steps 5–8 need a configured remote provider or
Ollama. Unit coverage (38 vitest cases) already pins retrieval assembly,
citation extraction, escaping, and the empty-retrieval floor; this checklist
covers what only the real shell can.

## Setup gating

- [ ] 1. **Unconfigured panel** — with no AI settings saved, the Ask panel
      shows "AI isn't set up yet" + a **Set up AI** button; no composer is
      rendered. Clicking **Set up AI** opens the AI settings modal (C1).
- [ ] 2. **Configured panel** — save a provider (e.g. Ollama preset) and
      reopen the Ask panel: composer + **Ask** button appear; the empty-state
      hint reads "Ask anything about your world…".

## Honesty floor ("not in your world")

- [ ] 3. **Empty retrieval stays local** — ask "zzzqqq nothing matches
      this" in a vault without that text: the reply is "That isn't in your
      world yet." with NO model round-trip (devtools network tab / proxy
      log shows no ai_chat invocation). If any note title fuzzy-matches the
      question, up to 3 suggestion chips appear; clicking one fills the
      composer.
- [ ] 4. **Open note always counts** — open any note and ask the same
      nonsense question: still the local reply, BUT ask a question the open
      note answers and the answer cites the open note.

## Cited answers

- [ ] 5. **Answer cites paths** — ask a factual question the vault can
      answer (e.g. "Who rules Vael'Thor?"): the answer cites note paths as
      `[[path]]`, rendered as gold inline links; the citation strip below
      lists the source paths as chips.
- [ ] 6. **Chips and links jump** — click a citation chip: the note opens
      (at the cited line when the model gave `path:line`). Click an inline
      `a[data-path]` link in the answer body: same jump.
- [ ] 7. **Follow-up keeps context** — ask a follow-up ("And when did that
      happen?"): the answer uses the earlier turn (history is threaded into
      the prompt). History lives only in memory — switch notes away and
      back (or reload): the log is empty again.
- [ ] 8. **Context shows the open note's backlinks** — with a note open
      that other notes link to, ask about the open note: answers can cite
      the linking (backlink source) notes too.

## Failure copy (per AiError kind)

- [ ] 9. **Key rejected** — store a bad key for a remote provider and ask a
      citable question: the chat shows "Key rejected — check Settings." —
      no raw exception text, no endpoint internals in the bubble.
- [ ] 10. **Endpoint unreachable** — point the Base URL at a dead https
      host and ask: "Couldn't reach your AI endpoint." (timeouts show
      "Your AI endpoint timed out — try again."; errors clear on the next
      successful ask).

## Prompt-injection discipline

- [ ] 11. **Hostile note content stays inert** — a note containing raw
      HTML/`<script>` or fake "instructions" gets retrieved into context;
      the rendered answer (and the context excerpts shown in devtools) never
      execute markup — the answer area shows escaped text only.
