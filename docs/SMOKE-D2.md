# SMOKE-D2 — Findings panel (M2 Wave D2)

Manual checklist for the audit Findings panel: run audit (rules always, LLM
on confirm), grouped findings with clickable quote pairs, dismiss with
tombstone, pre-run cost estimate. Run against a vault with seeded
contradictions (see `fixtures/` or the SMOKE-D2 seed list below). Automated
coverage: `src/core/audit/findings-view.test.ts` (sort/group/estimate math)
and `src/panels/findings-flow.test.ts` (headless dismiss → suppress loop).

## Seed vault (known contradictions)

1. Two notes claiming the name "Ellara" (title or alias) → duplicate-alias ×1
2. Frontmatter `relations: [{kind: ruler, target: "Ghost Queen"}]` with no
   such note → missing-relation-target ×1
3. A `[[The Unmade]]` wikilink with no matching note → dead-link ×1
4. (LLM only) Two notes stating contradictory facts about the same event,
   each with a quotable sentence → llm-contradiction ≥1

## Checklist

### Rules pass (offline, always)

- [ ] Open the vault; the panel header shows "Findings" with count 0 and the
      empty state "No contradictions found." before any run.
- [ ] Click **Run audit** → seeded structural findings appear instantly,
      grouped by note path (sorted), first run expands every group.
- [ ] Ordering: any AI contradictions sort above duplicate-alias, above
      missing-relation-target, above temporal-overlap, above dead wikilink;
      within a kind, notes are path-ordered.
- [ ] Each row shows a kind badge, the message, and its quote block(s);
      frontmatter findings carry no line number (path only).

### LLM pass (capability + confirm)

- [ ] With NO API key stored: header shows the one-line note "LLM pass needs
      an API key — rules pass still works"; Run audit still works (rules).
- [ ] With a key stored (or Ollama local): Run audit → rules findings render,
      then the cost-estimate dialog opens showing the batch count and
      estimated USD (input + output allowance), plus a note when the cost
      table is unset.
- [ ] Cancel → dialog closes, rules findings stay, no network call.
- [ ] Confirm → progress line "Auditing with AI… batch N of M" ticks per
      completed batch; on completion llm-contradiction rows appear (quoted
      evidence on both sides, both clickable).
- [ ] Incremental: Re-audit immediately → pending batches = 0 (all mtimes
      stamped) → no confirm dialog, no spend; findings persist.

### Quote navigation ("open + reveal both notes")

- [ ] Click quote A → parent opens note A and reveals/scrolls to the quoted
      line (M1.2 reveal); same for quote B on the other note.
- [ ] Frontmatter findings (line −1) open the note without a reveal target.

### Dismiss + tombstone

- [ ] Dismiss a finding → row disappears immediately; the group count drops;
      an emptied group disappears.
- [ ] File an external edit elsewhere, Re-audit → the dismissed finding does
      NOT come back (tombstone id = content hash, survives line shifts).
- [ ] Edit the dismissed notes' bodies (quotes still present, lines shift),
      Re-audit → still suppressed.
- [ ] Corrupt the audit state file (`audit/<vaultHash>.json` → garbage),
      Re-audit → no crash; the panel re-audits from scratch and the next
      dismiss rewrites clean state.
- [ ] Dismiss fails (make the port read-only / app-data unwritable) → error
      line shows and the row STAYS visible (no phantom suppression).

### Degradation

- [ ] No vault open → Run audit disabled.
- [ ] Invalid/unreachable endpoint at confirm time → error line with the
      typed message; rules findings stay visible; state file not rewritten.
