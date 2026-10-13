# SMOKE — M2 Wave E1 · Extraction proposals

Manual checklist for the per-note extraction panel (PLAN-M2 §E1, PRD-M2 §3).
Automated coverage: `src/core/ai/extraction-queue.test.ts`,
`src/core/ai/accept-extract.test.ts`, `src/panels/extraction-proposals.test.ts`
(41 vitest cases — queue ordering/rate cap/cancel, merge matrix, provenance,
tombstones, parser round-trip).

**Precondition:** the ExtractionPanel is mounted by the I1 integration
(`src/App.tsx` wires the open note + aiSettings endpoint + the store's
`saveNote` as the injected save). Until I1 lands, run this checklist against
the mounted component in a dev branch — the panel itself performs no I/O, so
"the file changed on disk" below proves the injected save path end-to-end.

Run inside the desktop shell (`npm run tauri dev`) with a vault open and AI
configured per `docs/SMOKE-C1.md` (provider + stored key), unless a step says
otherwise.

## Gating (unconfigured AI)

- [ ] 1. **No key → CTA** — delete the key (`invoke('key_delete')` in
      devtools), open a note: **Extract entities** is disabled and hovering
      it shows the tooltip "Set up AI first — open Settings → AI settings…".
      No network call is attempted (devtools network tab empty).
- [ ] 2. **Configured → enabled** — store a key, reopen the note: the button
      is enabled.

## Extraction run

- [ ] 3. **Happy path** — click **Extract entities**: button reads
      "Extracting…", the header shows a `0/1` counter, then proposal rows
      appear (kind badge, value, confidence bar + %). Rows with confidence
      ≥ 70% arrive pre-checked; lower ones unchecked.
- [ ] 4. **Empty result** — extract a note with no detectable metadata →
      notice "Nothing new — the model repeated what the frontmatter already
      carries." and no rows.
- [ ] 5. **Bad endpoint/model** — point the Base URL at an unreachable host,
      extract → red notice with the transport error; the panel stays usable
      (fix the URL, extract again → rows appear).

## Tombstones (dismiss)

- [ ] 6. **Per-row dismiss** — click ✕ on a row: it disappears immediately.
      Extract the same note again: that proposal does NOT reappear, even
      though the model proposes it again (hash tombstone, confidence-blind).
- [ ] 7. **Dismiss all** — with several rows showing, **Dismiss all** clears
      the list; re-extract → nothing reappears for this session.
- [ ] 8. **Persistence seam** — if I1 wired `onDismiss`/`dismissed` to the
      store: restart the app, re-extract → dismissed proposals stay
      suppressed.

## Accept

- [ ] 9. **Accept selected** — check two rows (an alias + a relation), click
      **Accept selected (2)**: rows collapse into "✓ applied to frontmatter";
      the .md file on disk now has the new `aliases` / `relations` merged
      with the existing values (no duplicates), the body text is untouched,
      and exactly ONE comment sits at the end of the file:
      `<!-- wl:extracted <iso> confidence=0.xx -->`.
- [ ] 10. **Existing type survives** — a note that already has `type:` keeps
      it after accepting an entity proposal (override is off by default).
      A note WITHOUT `type:` gains the entity's type.
- [ ] 11. **Re-accept doesn't stack** — run extraction again, accept another
      proposal: the file still contains exactly ONE `wl:extracted` comment
      (the newest); the earlier alias is still in the frontmatter.
- [ ] 12. **Editor sync** — after Accept, the open editor shows the updated
      source; the backlinks/auditor views treat the new relation normally
      (e.g. a relation to a nonexistent note surfaces as a rules finding).

## Queue discipline

- [ ] 13. **Rate cap** — (needs I1 multi-note enqueue or a dev branch loop)
      enqueue several notes for extraction: requests fire at ≤ 2/sec —
      devtools/Tauri logs show ≥ 500 ms between `ai_chat` invocations.
- [ ] 14. **Cancel** — unmount/switch notes mid-run: the in-flight result is
      discarded (no rows appear for the abandoned note) and no pending note
      is ever requested.
