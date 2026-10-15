# PRD — Worldloom M2.5 ("import wizard: bring the mess") — DRAFT

**Date:** 2026-10-15 · **Author:** Orchestrator (Hermes) · **Status:** 🚧 DRAFT — NOT APPROVED. Awaiting
`gate:m2.5` (CTO). Nothing in this document may be implemented before the gate; wave estimates are placeholders.
**Input:** DISCOVERY-import-wizard.md (56 sources, 2026-10-15), DISCOVERY-gm-workflows.md (51 sources),
PRD-M2.md out-list ("Import wizard … candidate for M2.5, acquisition wedge, defer until auditor ships"),
ARCH.md (installer ≤15MB, RAM/start targets, zero-network M1 posture), ADR-002 (files are the user's property),
ADR-004 (BYO AI, vault content untrusted).

## Vision (M2.5 = the acquisition wedge)

The documented cost of switching is measured in weekends: "two weeks of evenings" to move 6 years of TTRPG notes
out of Notion; "two months" hand-importing 3,000 notes ([DISCOVERY-import-wizard §1.2](DISCOVERY-import-wizard.md)).
Obsidian's own importer still ships broken links and messy embeds; Google Docs and Word have no importer at all
in the benchmark plugin. M2.5 ships a **local-first import wizard**: drop in a Notion export zip / markdown
folder / `.docx` / Google-Docs `.md` folder → clean Worldloom notes with wikilinks reconciled, assets relocated,
and an **honest loss report** ("what didn't survive"). Promise: *nothing silently lost, nothing leaves your
machine.*

## Target user

- **P1 switcher** (primary): committed GM with a Notion workspace built on Lazy-DM-style templates + databases;
  lock-in fear is the buying trigger ([DISCOVERY-gm-workflows RQ4](DISCOVERY-gm-workflows.md)).
- **P3 pragmatist** (secondary): folder-of-Google-Docs GM; import must work without any account, token, or API.
- **P2 worldbuilder-author** (tertiary): Scrivener/Word users arriving as `.docx`/`.md` folders.

## M2.5 scope (user stories)

1. **As a Notion user,** I drag Notion's "Markdown & CSV" export `.zip` onto the wizard and get: UUID suffixes
   stripped from filenames, `Export-…` asset folders relocated + referenced relatively, internal UUID links
   rewritten to `[[wikilink]]`/markdown links by title map, callout-HTML → our callout rendering, toggles →
   headings (collapse preserved where cheap), per-page minimal frontmatter, and a report listing every loss
   class (databases→CSV kept as table notes; relations/rollups/formulas noted as not recoverable).
2. **As a Notion HTML-export user,** I can drop the HTML `.zip` instead (higher fidelity: toggles/callouts/links
   survive — the path Obsidian officially recommends) with the same report contract.
3. **As an Obsidian-vault / markdown-folder user,** I open the folder and the wizard validates instead of
   converts: note count, unresolved wikilinks, filename collisions, broken asset paths — then hands off to the
   normal M1 index. (Worldloom already opens markdown folders; this story makes the entry point legible.)
4. **As a Word/Google-Takeout user,** I drop one `.docx` or a folder of them; each becomes one note via an
   in-app docx→HTML→markdown pipeline (pure TS; images extracted to local assets). Tracked changes/comments/text
   boxes are detected and warned about *before* import (silent loss is the documented sin of every converter).
5. **As a Google Docs user,** I'm guided to File → Download → Markdown per doc (or Takeout `.docx` bulk) and
   drop the folder; no Google account or API is ever involved.
6. **As any importer,** I see a pre-import summary (source detected, N items, est. size, per-format loss table)
   and a post-import report (created notes, rewired links, converted callouts, skipped items with reasons);
   import goes into a chosen subfolder, never overwrites existing notes, and is undoable as "delete what this
   import created".
7. **As a security-conscious user,** I know the import ran entirely offline: imported HTML is sanitized through
   the same pipeline as preview rendering; no network calls are made (verifiable like M1's zero-network claim).

## Explicitly OUT of M2.5 (BINDING out-list — any change needs a new PRD revision at the gate)

1. **No Notion API/live-connection import** (no tokens, no network; the "connect your workspace" path belongs to
   a future decision — see open question Q2 of discovery). Rationale: local-first trust story + Notion API
   churn + rate limits documented in discovery §4.2.2.
2. **No reconstruction of Notion database relations, rollups, formulas, views** — impossible from file export
   (Notion's own docs + practitioner consensus). CSVs land as table notes; semantic re-structuring is M2
   extraction's job, not the wizard's.
3. **No platform-format importers**: World Anvil JSON/BBCode, Kanka JSON, LegendKeeper `.LK`/JSON, Campfire
   Blaze, Evernote `.enex`, OneNote `.one`, Apple Notes. (Debt stays with the platforms that own those
   formats; revisit only with usage evidence.)
4. **No Scrivener `.scriv` parsing** — accept only what Scrivener emits (`.md`/`.docx`).
5. **No Google Drive/Docs API integration**, no accounts, no OAuth, no cloud fetch of any kind.
6. **No PDF import, no OCR, no image-to-text.**
7. **No bundling Pandoc** (installer ≤15MB hard requirement); at most detect a user-installed Pandoc as a
   hidden advanced option — assumption: <5% of target users, do not surface in UI.
8. **No auto-merge/dedup of synced-block duplicates** — detected and reported only (M2 principle: never
   auto-edit the user's world).
9. **No import of emoji/property icons, block colors, or Notion layouts into frontmatter** — stripped, listed
   in report; frontmatter v1 subset stays as-is (extension needs its own ADR).
10. **No export features** (that's M3), no re-import/round-trip guarantee, no migration *between* Worldloom
    vaults.

## Success criteria (proposed — to be confirmed at gate)

- **Fixture-corpus tests** in the existing vitest suite, following the Obsidian Importer pattern (fixture zip →
  recorded expected output → diff): ≥6 fixtures (Notion md+csv small/medium, Notion HTML, nested-part-zip,
  docx with tracked changes + images + footnotes, Google-Docs `.md` folder).
- **Fidelity floor:** every text character of the source corpus appears either in an imported note or in the
  loss report — zero silent drops (report is machine-checked against fixture manifests).
- **Link integrity:** ≥99% of internal links in a 500-note Notion fixture resolve post-import (title-map
  reconciliation); all unresolved ones listed in the report.
- **Perf envelope:** 500-note Notion zip import ≤60s on the dev machine; memory stays under the app's RAM
  target; cancel works at any point and leaves nothing behind (staging dir).
- **Windows safety:** deterministic filename shortening defeats MAX_PATH on deep UUID hierarchies; Unicode +
  duplicate-title collisions handled with a documented rule.
- **Zero network:** import path contains no fetch/XHR (same verification method as M1's zero-network claim).
- **234 existing tests stay green**; M2 auditor untouched; imported files carry whatever provenance the gate
  decides (open question Q6).
- **Gate metric (external, mirrors M1's validation gate):** the import story appears in the pre-sell/landing
  copy and drives ≥3 measurable "I'd switch for this" intents before licensing work starts.

## Wave plan (first cut — durations are placeholders until the gate budgets them)

| Wave | Content | Depends on | Rough size |
|---|---|---|---|
| **W0 — Spike & corpus** | Acquire 3–5 real anonymized exports (Notion md+csv, Notion HTML, Takeout docx, Docs md folder, messy docx); run them through Obsidian Importer + notion2obsidian + mammoth prototype for side-by-side; record fixture harness (importer-style expected-output tests) | Gate approval; fixture acquisition budget (discovery Q7) | S |
| **W1 — Vault adopt + report shell** | Folder-open validation flow (story 3), pre/post report UI, staging-dir import target + folder-level undo, sanitization review of the HTML path (untrusted-input rule) | W0 | M |
| **W2 — Notion Markdown&CSV zip** | Zip streaming, UUID strip + title map + link rewrite, asset relocation, callout/toggle mapping, CSV→table notes (pending Q3), MAX_PATH shortening (story 1) | W1 | M |
| **W3 — Notion HTML zip** | HTML→md parser over Notion's export dialect (details/figures/data-block-id), nested-part-zip handling (story 2) | W2 (shares map/report machinery) | M |
| **W4 — docx + Google Docs** | Pure-TS docx→HTML→md pipeline, image extraction, tracked-changes/comment detection warnings, folder mode, Docs `.md` cleanup (stories 4–5) | W1 | M |
| **W5 — Polish & wedge packaging** | Progress/cancel/resume on large imports, per-format loss tables in-product (PostRoll-style), landing-page copy hooks ("links intact, nothing silently lost"), docs | W2–W4 | S |

**Explicit non-goal inside M2.5:** no AI calls. The wizard is deterministic; M2's extraction proposals are the
documented follow-up for users who want their Notion databases re-structured as frontmatter relations
(discovery §4.2.1) — cross-link the two in-product, don't merge them.

## Top risks (pre-mortem seeds)

1. **Fidelity whack-a-mole** — every real export contains constructs no fixture had (mirrors Obsidian
   Importer's living bug tracker). Mitigation: the report contract means imperfect conversion is *visible*, not
   fatal; fixture corpus grows from user reports.
2. **Scope creep toward "convert everything"** — the out-list is binding; new formats = new PRD row (ARCH
   pre-mortem #3, same pattern).
3. **Wedge arrives late** — M2.5 depends on M2 shipping; if the auditor slips, W1 (vault adopt + report) is
   independently valuable and can ride earlier. (Open question Q8.)

## Open questions for the gate (full list in discovery §5)

Q1 wedge order (Notion vs Google-Docs first) · Q2 Notion API ever? · Q3 CSV→note strategy · Q4 report as dialog
vs persisted file · Q5 undo model · Q6 provenance stamps vs frontmatter-v1 · Q7 fixture acquisition budget ·
Q8 ship W1 inside M2 as onboarding?
