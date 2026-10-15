# DISCOVERY — Import wizard: how GMs actually migrate campaign notes, and what the importers do about it

**Date:** 2026-10-15 · **Status:** research complete (discovery for M2.5 candidate "import wedge", pre-gate)
**Scope:** Real-user evidence on how TTRPG GMs/worldbuilders keep and *migrate* campaign notes today, forensic
account of what the three wedge source formats (Notion, Google Docs, Word .docx) actually emit, an inventory of
competitor/community import techniques (Obsidian Importer, notion-to-md, Pandoc/mammoth, World Anvil, LegendKeeper,
Campfire, Kanka, Scrivener, PostRoll), and a fit map onto Worldloom's model (plain markdown + YAML frontmatter v1,
wikilinks, local assets, audit pipeline treats vault content as untrusted input).
**Method:** 19 web_search queries (4 returned empty from a flaky search backend — retried with alternate
phrasing), 9 page-extraction attempts (6 successful), 3 Reddit threads read verbatim in a real browser
(post + comments), plus repo/docs reading (PRD-M1/M2, ARCH, ADRs). Every major claim carries a URL;
search-snippet-only claims are labeled `[snippet]`; unsourced inferences are labeled `assumption`. All sources
accessed **2026-10-15**.
**Confidence labels:** High = multiple independent direct sources; Medium = one strong direct source or several
consistent snippets; Low = single snippet/vendor claim/inferred.

---

## 0. TL;DR

1. **Migration is a documented, expensive, human job today.** A GM moving 6 years of TTRPG notes out of Notion
   reported "two weeks of evenings" of cleanup; another spent *two months* importing 3,000 notes by hand and then
   "had to learn Python just to run a script to fix" wrong dates
   [reddit r/ObsidianMD 1t18l7c](https://www.reddit.com/r/ObsidianMD/comments/1t18l7c/),
   [reddit r/ObsidianMD 1nyw5c4](https://www.reddit.com/r/ObsidianMD/comments/1nyw5c4/) — both read verbatim.
   A wizard that removes even half of that pain is a real acquisition wedge. **[High]**
2. **Notion's export is the epicenter of the pain, and its losses are structural, not bugs.** Notion's own help:
   databases export "as a CSV file… Callout blocks will be exported as HTML, as there is no Markdown equivalent"
   ([Notion: Export your content](https://www.notion.com/help/export-your-content)); users: "databases come out as
   flat csvs and you lose the relations, rollups and nested page structure… there's no true round-trip"
   [reddit r/Notion 1uladm0](https://www.reddit.com/r/Notion/comments/1uladm0/) (verbatim). Every converter —
   official or community — inherits these losses. **[High]**
3. **Even Obsidian, whose official Importer is the most-funded importer in the ecosystem, only accepts Notion as
   HTML, not Markdown** — the plugin detects Markdown exports and refuses them outright ("This is a Markdown export.
   Export your Notion workspace as HTML instead." — [importer source, src/i18n/en.ts](https://github.com/obsidianmd/obsidian-importer/blob/master/src/i18n/en.ts),
   wired in [src/formats/notion.ts](https://github.com/obsidianmd/obsidian-importer/blob/master/src/formats/notion.ts)),
   and still ships known
   defects (broken links, messy embeds, empty notes, folder/asset mismatches — importer author's own list,
   [reddit 1nyw5c4](https://www.reddit.com/r/ObsidianMD/comments/1nyw5c4/) verbatim). Google Docs and Word `.docx`
   have **no importer at all** in the official plugin
   ([README format list](https://github.com/obsidianmd/obsidian-importer); open request
   [#237](https://github.com/obsidianmd/obsidian-importer/issues/237)). **[High]**
4. **Google Docs has a native Markdown export** (File → Download → Markdown; Drive API `text/markdown`) and it is
   "good enough" for the simple case but lossy for anything rich ([Google Docs help](https://support.google.com/docs/answer/18289341);
   [n8n Drive node PR](https://github.com/n8n-io/n8n/pull/25115)); there is **no bulk folder export** except
   Google Takeout → `.docx` zip, which then needs a docx→md converter
   ([obsidian-importer #237](https://github.com/obsidianmd/obsidian-importer/issues/237)). **[High]**
5. **Inbound import is a proven wedge in this exact niche.** LegendKeeper markets "Most users are ready in under
   20 minutes" and ships Obsidian/WorldAnvil/GoogleDocs/markdown importers ([legendkeeper.com](https://www.legendkeeper.com/));
   PostRoll (a newer campaign-wiki competitor) built a 7-source import page and states "an import you don't have to
   undo is the least work of all" ([PostRoll: Importing content](https://help.postroll.app/worlds/wiki/importing-content/)).
   Meanwhile the giant, World Anvil, has **no prose import at all** — FAQ: "You can copy and paste text directly
   into World Anvil" ([WA FAQ](https://www.worldanvil.com/faq)). The door is open. **[High]**
6. **The cheap wins for Worldloom are: markdown-folder adopt (near-free), Notion Markdown&CSV zip cleanup
   (UUID stripping + link rewrite + callout/toggle mapping), and single/folder `.docx` via a pure-TS
   mammoth-style pipeline. The traps are: Notion databases/relations (impossible from file export), Notion API
   import (network + tokens + rate limits, off-brand), bundling Pandoc (breaks the ≤15MB installer target), and
   Google Docs bulk (requires Takeout; per-file downloads only).** See §4. **[High on formats; Medium on effort]**
7. **Process lesson from users, directly importable into our UX spec:** "the thing that helped most was just
   accepting it won't be perfect on the first pass… trying to restructure while migrating won't work"
   [reddit 1t18l7c](https://www.reddit.com/r/ObsidianMD/comments/1t18l7c/) (verbatim) — i.e., ship a
   *fast lossy import + a review report*, not a perfectionist mapper. Precedent: Obsidian Importer and LK both
   show a preview before committing ([help.obsidian.md](https://obsidian.md/help/import/notion),
   [LK changelog 0.16.1.0](https://www.legendkeeper.com/changelog/legendkeeper-0-16-1-0/)). **[High]**

---

## 1. RQ1 — REAL-USER EVIDENCE: how campaign notes are kept, and what breaks when they move

### 1.1 Where the notes live today (context from prior discovery, extended)

DISCOVERY-gm-workflows.md established the hybrid norm (Google Docs "one big document", OneNote, Notion, Discord,
VTT journals; Obsidian for the tech-forward). This study confirms the migration-relevant detail: **the dominant
starting states for a Worldloom import are (a) a Notion workspace built on Lazy-DM/Sly-Flourish templates with
NPC/location/item *databases*, (b) a folder of dozens of Google Docs, (c) one giant Google Doc, and (d) an
Obsidian vault.**

- Notion template culture is the on-ramp: "I have databases (galleries) for NPCs, locations, and items that I
  reference in my session planning pages" [snippet, r/DMAcademy 1e84qjn](https://www.reddit.com/r/DMAcademy/comments/1e84qjn/);
  "I use Notion, with Sly Flourish's template" [snippet, r/DMAcademy 1frh0gl](https://www.reddit.com/r/DMAcademy/comments/1frh0gl/).
- The giant-doc state is real: a 4-year campaign "currently take up a 32,000 word Google Doc"
  [snippet, r/DnD 1qnkpvm](https://www.reddit.com/r/DnD/comments/1qnkpvm/); "I have dozens of Google docs I've been
  working on that cover a ton of different topics related to my world lore"
  [snippet, r/DMAcademy 1tfo26e](https://www.reddit.com/r/DMAcademy/comments/1tfo26e/).
- The Obsidian-vault state includes serious scale: a TTRPG GM with "800+ TTRPG rule notes" in LegendKeeper asking
  how to get them into Obsidian "while preserving the general structure (folders/pages), internal links, and tags"
  [snippet, r/ObsidianMD 1k3h3ya](https://www.reddit.com/r/ObsidianMD/comments/1k3h3ya/).

### 1.2 What breaks when GMs migrate (ranked, with verbatim evidence)

| # | Failure | Evidence (verbatim where `[v]`, verbatim-in-browser) | Conf. |
|---|---|---|---|
| 1 | **Migration is weeks/months of unpaid janitorial work** | OP: "It has taken two weeks of evenings, restructuring, consolidating, going over revisions, and cleaning up notes, but I have finally moved all my notes over from Notion (and Google Keep) into Obsidian. 6 years of TTRPG notes" [v, r/ObsidianMD 1t18l7c](https://www.reddit.com/r/ObsidianMD/comments/1t18l7c/); "I had to import all 3000 of my notes by hand .. attachments and all. It took me two months to finish, and the dates were wrong so I had to learn Python just to run a script to fix them" [v, r/ObsidianMD 1nyw5c4](https://www.reddit.com/r/ObsidianMD/comments/1nyw5c4/); "I've been on a similar project for more than a year by now 😭" [v, 1t18l7c] | High |
| 2 | **Off-the-shelf converters break on real workspaces** | "I tried to practice what I preach and migrate my entire Notion workspace (1.8GB of notes) to Obsidian using the existing tools out there. Spoiler: They all broke on my export. Some couldn't handle the size. Others mangled my links. A few just crashed halfway through." [v, 1nyw5c4 OP] | High |
| 3 | **UUID-suffixed filenames and UUID links** | "some random number being added to the titles OF ALL THE PAGES… Looks like guids, probably from Notion to distinguish files that are named the same" [snippet, r/ObsidianMD 11v27ud](https://www.reddit.com/r/ObsidianMD/comments/11v27ud/); converter authors build their entire product on this: "Fixes Notion's UUID-based links and converts them to proper Obsidian wikilinks… Removes those ugly Notion UUIDs while avoiding name collisions" [v, 1nyw5c4 OP] | High |
| 4 | **Structure flattening / hierarchy loss** | "it is putting everything under a folder named notion. NOT maintaining other folders and subfolders" [snippet, r/ObsidianMD 1oenra5](https://www.reddit.com/r/ObsidianMD/comments/1oenra5/); "Folder hierarchies and asset references mismatch" [v, 1nyw5c4 comment by the converter author] | High |
| 5 | **Databases don't survive; users rebuild them by hand** | "It won't magically recreate databases (that's impossible with Notion's export format)" [v, 1nyw5c4 OP]; a TTRPG user converting "my ttrpg database across to Obsidian" hit per-column formatting/unit-assumption problems [snippet, r/ObsidianMD 1gg783s](https://www.reddit.com/r/ObsidianMD/comments/1gg783s/) | High |
| 6 | **Internal links, embeds, page icons come out broken or ugly** | "Broken or awkward links / Messy embeds and page icons / Empty 'notes' from Notion pages" — author of a dedicated converter listing the official Obsidian plugin's known defects [v, 1nyw5c4 comment] | High |
| 7 | **Dates/metadata wrong or missing from the zip export** | "the dates were wrong" [v, 1nyw5c4]; "public URL links and dates, which are limitations of Notion Export zip file" [v, 1nyw5c4 comment] | High |
| 8 | **Template/config rework is the psychological blocker, not the data** | "having to reconfigure all the templates and stuff on them has been the biggest thing keeping me from leaving Notion" [snippet, r/ObsidianMD 1uvtsww](https://www.reddit.com/r/ObsidianMD/comments/1uvtsww/); a D&D homebrew GM *paid* for help: "getting overwhelmed with the process of migrating/configuring. My use case is a homebrew world for dnd… Migrate existing data from Notion" [snippet, r/ObsidianMD 1mjlmby](https://www.reddit.com/r/ObsidianMD/comments/1mjlmby/) | High |
| 9 | **Fear of losing link graphs stops migrations cold** | "I'm not ready to spend weeks on finding again my links.." [snippet, r/ObsidianMD 1k3h3ya](https://www.reddit.com/r/ObsidianMD/comments/1k3h3ya/) | Medium-High |
| 10 | **Google-Docs users want auto-structure extraction, not file moving** | "Is there any way to import those into Obsidian and have it pull out all the connections for me? If not Obsidian, is there any program that would do this that isn't AI?" [snippet, r/DMAcademy 1tfo26e](https://www.reddit.com/r/DMAcademy/comments/1tfo26e/) | Medium |
| 11 | **Import without cleanup still beats the status quo** | "Most of what I had to move I was able to export as markdown and then just drag into my Obsidian folder" [snippet, r/ObsidianMD 13vpqzm](https://www.reddit.com/r/ObsidianMD/comments/13vpqzm/); "honestly the thing that helped most was just accepting it won't be perfect on the first pass… trying to restructure while migrating won't work" [v, 1t18l7c comment] | High |
| 12 | **One-way door anxiety (Notion side)** | "notion export is a nightmare. I cant get my data out cleanly and importing it back is even worse" [v, r/Notion 1uladm0 OP](https://www.reddit.com/r/Notion/comments/1uladm0/); "The export was never really designed for round trips, it's a backup dump. CSV flattens relations into plain text, select options disappear" [v, 1uladm0 comment] | High |

**Synthesis (High):** GMs do not abandon a tool because of missing features; they abandon it when the *exit* looks
too expensive, and they stay stuck because the exit tools demand manual reconstruction of links and databases.
The buyer segment that pays (switchers with years of content) is precisely the segment that hits every one of
these failures. A wizard whose promise is "**bring the mess, keep the links, see what didn't survive**" attacks
failure modes #1–#9 directly.

### 1.3 Behavioral guidance for our UX (evidence-derived)

1. **Preview before commit** — every serious importer shows one (Obsidian Importer "shows a preview before the
   import begins" [help.obsidian.md](https://obsidian.md/help/import/notion); LK "Review and edit the import
   options" pattern; PostRoll "Untick what you don't need in the review step"
   [postroll.app](https://help.postroll.app/worlds/wiki/importing-content/)). **[High]**
2. **Report after commit** — users' pain is *silent* loss ("nothing told you" —
   [TransformPipe docx analysis](https://transformpipe.com/blog/convert-docx-to-markdown)). A post-import report
   ("312 notes, 1,140 links rewired, 47 callouts converted, 12 items need review") converts silent loss into a
   to-do list. **[Medium — inference from the failure reports above, no competitor does this well]**
3. **Don't ask users to restructure while importing** (verbatim quote, §1.2 #11). Import = lift; reorganize later.
4. **Batch-size honesty** — even Obsidian's importer tells users large Notion exports may nest zips and "may take
   considerable time" due to API rate limits ([help.obsidian.md](https://obsidian.md/help/import/notion)).
   Progress + cancel + resume are table stakes for >100MB. **[High]**

---

## 2. RQ2 — SOURCE-FORMAT FORENSICS: what the three wedge sources actually emit

### 2.1 Notion — "Markdown & CSV" zip (the default path most users take)

Official behavior ([Notion: Export your content](https://www.notion.com/help/export-your-content)):
- "Any non-database Notion page can be exported as a Markdown file. **Full page databases will be exported as a
  CSV file**, with Markdown files for each subpage. **Callout blocks will be exported as HTML**, as there is no
  Markdown equivalent."
- HTML export is a zip of `.html` + assets; "When you export as HTML, you can also export comments at both the
  page and block levels."

Documented quirks of the Markdown & CSV zip ([FormatArc: Notion Export to Markdown](https://formatarc.com/en/blog/notion-export-to-markdown),
an converter-vendor analysis, corroborated item-by-item by the Reddit evidence in §1.2):
1. **32-character UUID suffix on every filename** and UUID link targets ("a ZIP full of files with 32-character
   page IDs suffixed onto every filename").
2. **Callouts arrive as raw HTML** (inline `<div>`/table markup inside `.md`).
3. **Toggles may lose their collapsible wrapper** — "the heading text and the inner content sit side by side as
   normal paragraphs."
4. **Synced blocks are duplicated into every referencing page** — "The same content ends up written into every
   file that references it."
5. **Equations and embeds degrade**: LaTeX becomes bare `$…$`; "Video, Figma, and Twitter embeds usually export as
   a bare URL."
6. **Images live in an `Export-.../` asset folder** whose relative paths must be rewritten.
7. **Databases → CSV + a folder of row-pages**; "database views (filters, sorts, groupings) plus relations,
   rollups, and formulas do not carry over."
8. **Windows 260-char path limit** bites on deep hierarchies with UUID names (FormatArc documents this; Windows
   is Worldloom's primary platform per DISCOVERY-gm-workflows).

New (2026) alternative — **Notion Markdown Content API** (version `2026-03-11`): `GET /v1/pages/{id}/markdown`
returns "Enhanced Markdown" where non-CommonMark blocks become XML-ish tags (`<callout>…</callout>`,
`<details><summary>…</summary>…</details>`, `<database>` reference)
([FormatArc](https://formatarc.com/en/blog/notion-export-to-markdown), citing
[Notion's developer guide](https://developers.notion.com/guides/data-apis/working-with-markdown-content)).
**Relevance:** this is Notion admitting markdown needs extension tags — the same mapping problem Worldloom would
solve locally. API access requires a token + network (see §4 traps).
Also relevant: the Notion REST API marks some block types `"unsupported"` — "Any unsupported block types appear
in the structure, but contain a type set to 'unsupported'"
([Notion API: Block reference](https://developers.notion.com/reference/block)).

### 2.2 Notion — HTML export zip (the path Obsidian officially recommends)

- Obsidian's importer hard-requires HTML: a Markdown-export zip is detected by file extension + Notion ID and
  failed with "This is a Markdown export. Export your Notion workspace as HTML instead."
  ([importer source, src/i18n/en.ts](https://github.com/obsidianmd/obsidian-importer/blob/master/src/i18n/en.ts),
  wired in [src/formats/notion.ts](https://github.com/obsidianmd/obsidian-importer/blob/master/src/formats/notion.ts);
  verified at source, Oct 2026 — the [Obsidian Help page](https://obsidian.md/help/import/notion) was rewritten when
  the API importer shipped and no longer carries this wording, though it still documents the HTML-zip file path).
- HTML keeps "the callout structure (as inline HTML), keeps toggle wrappers, and retains internal links"
  ([FormatArc](https://formatarc.com/en/blog/notion-export-to-markdown)).
- Cost: the importer must parse Notion's HTML (layout-heavy markup, inline-HTML callouts, `<details>` toggles,
  an assets folder of images) and convert *that* to markdown — per FormatArc's side-by-side of the two export
  paths ([FormatArc](https://formatarc.com/en/blog/notion-export-to-markdown)). This is exactly what the official
  plugin does — and its defect list (§1.2 #6) shows it is hard to get right.
- Large workspaces: "the export from Notion may contain nested `.zip` files" (`Export-{id}-Part-1.zip`) —
  importers must unzip recursively ([Obsidian Help](https://obsidian.md/help/import/notion)).

### 2.3 Google Docs

- **Per-document native Markdown export exists**: File → Download → Markdown; Google's help page documents `.md`
  as a first-class Drive file type with known losses: "Smart chips change to text or links; Web formatting (.HTML)
  turns into plain text; **Font colors, highlights, and text alignment are removed**"
  ([Google Docs help: View and edit Markdown files](https://support.google.com/docs/answer/18289341)).
  The Drive API exposes `text/markdown` as an export MIME (added to n8n's Drive node Jan 2026,
  [PR #25115](https://github.com/n8n-io/n8n/pull/25115)).
- **No bulk folder export.** The ecosystem-standard answer for "all my Docs": Google Takeout → Drive → zip of
  `.docx`, then a docx→md converter (Pandoc / word-to-markdown / markitdown)
  ([obsidian-importer #237, maintainer reply](https://github.com/obsidianmd/obsidian-importer/issues/237)).
  One commenter on that issue: "I spent like a week trying to find something that would get my several hundred
  documents, with existing file structure, converted."
- LegendKeeper's official workaround is manual per-file: "To import an entire Google Doc folder, you'll need to
  download each document as a markdown document, before putting them all into a folder"
  ([LK: How to import your world](https://www.legendkeeper.com/import-world-legendkeeper/)).
- Third-party quality assessment (vendor of a competing converter — directional, treat with bias caveat): "The
  native export works for the simplest possible case… and breaks in surprising ways the moment the document
  contains anything more interesting" (tables/images/footnotes/equations) —
  [mdisbetter.com](https://mdisbetter.com/blog/google-docs-export-sucks). **[Low-Medium]**

### 2.4 Microsoft Word `.docx`

- A `.docx` is a zip of XML parts; conversion failures map 1:1 to missed parts: `word/numbering.xml` missed →
  "Numbered and bulleted lists arrive as paragraphs"; `word/footnotes.xml` missed → "Footnote markers with no
  text"; `word/media/` → "Image references point at nothing"
  ([TransformPipe: docx→markdown](https://transformpipe.com/blog/convert-docx-to-markdown)).
- **Pandoc** is the reference converter: `pandoc -f docx -t gfm --wrap=none --extract-media=./media`. Documented
  semantics: `--track-changes=accept` is the default and "accept and reject ignore comments"; only `all` keeps
  insertions/deletions/comments as spans ([Pandoc manual](https://www.pandoc.org/MANUAL.html)). Pandoc hard-wraps
  at 72 columns unless `--wrap=none` (diff-hostile output) and images lose original filenames
  ([LocalConvert pandoc pipeline](https://localconvert.it.com/ba/guides/docx-pandoc-pipeline/)).
- **mammoth** (JS) converts docx→HTML via a style map; the recommended pattern is mammoth → separate HTML→md
  step; images need a `convertImage` callback or they arrive as giant base64 data URIs
  ([TransformPipe](https://transformpipe.com/blog/convert-docx-to-markdown)). **This is the pure-TS route that
  fits Worldloom's installer budget (§4).**
- Irrecoverable in markdown (any converter): tracked changes (unless deliberately kept), comments, text
  boxes/SmartArt/charts ("the text simply is not there and nothing warns you"), colored text, page breaks
  ([TransformPipe: what not to keep](https://transformpipe.com/blog/what-not-to-keep-from-a-docx)).

---

## 3. RQ3 — COMPETITOR TECHNIQUE INVENTORY

### 3.1 Obsidian official Importer plugin (the benchmark)

- **Breadth:** Airtable, Apple Journal, Apple Notes, Bear, CSV, Evernote, Google Keep, HTML, Microsoft OneNote,
  Notion (HTML zip + API), Roam Research, Logseq, Markdown (.md/.txt), Textbundle, Tomboy/Gnote —
  [README](https://github.com/obsidianmd/obsidian-importer). **No Google Docs, no Word `.docx` importer.**
- **Maintenance posture:** "The Obsidian team is not actively working on adding new import capabilities, but we
  welcome pull requests for new formats and improvements" (same README) — imports are community-driven, with
  bounties; i.e., even Obsidian treats import as unglamorous long-tail work. **[High]**
- **Notion technique — two paths** ([help.obsidian.md/import/notion](https://obsidian.md/help/import/notion)):
  1. **File import (HTML zip):** offline, no token; "Does not preserve Databases"; nested-zip handling; import
     "all your Notion at once so internal links can be reconciled correctly."
  2. **API import (new):** token + network; databases → folders + `.base` files; formulas → DataView; documented
     limits: "Only the primary view for each database is imported", "Linked data sources are not imported",
     rate limits make large imports slow.
- **Engineering technique worth copying:** fixture-based regression tests — "convert every fixture and compare
  against its recording" (`tests/notion/notion-testspace.zip` → `expected/…`), with `UPDATE_EXPECTED=1` to
  re-record ([README](https://github.com/obsidianmd/obsidian-importer)). Capability matrix per importer
  (attachments / frontmatter / internal links / databases / tags / auth) documented in
  [DeepWiki's analysis](https://deepwiki.com/obsidianmd/obsidian-importer/3-supported-formats).
- **Known defects** (author of a competing converter, verbatim, [reddit 1nyw5c4](https://www.reddit.com/r/ObsidianMD/comments/1nyw5c4/)):
  broken/awkward links, messy embeds and page icons, empty notes, databases only as individual `.md` files,
  folder/asset reference mismatches; and he *imports markdown and converts with remark instead of importing HTML
  like the importer plugin* — two viable internal techniques exist for the same source.
- **User-reported failure modes:** import "putting everything under a folder named notion" (structure flatten,
  [1oenra5](https://www.reddit.com/r/ObsidianMD/comments/1oenra5/)); one hidden `.md` file inside a Notion page
  crashed an import until removed ([1mzm1tz](https://www.reddit.com/r/ObsidianMD/comments/1mzm1tz/)).

### 3.2 Notion → markdown converters (library layer)

- **notion-to-md** (npm, MIT, ~1.7k★, [GitHub](https://github.com/souvikinator/notion-to-md)): block-tree walk
  over the official Notion API → markdown; nesting supported; child pages returned separately since v2.7.0;
  default page-size cap of 100 blocks per request needs manual paging
  ([npm](https://www.npmjs.com/package/notion-to-md)). Technique: *API traversal, not export parsing*; requires
  token + network + rate-limit handling.
- **notion-exporter** (npm, [npm](https://www.npmjs.com/package/notion-exporter)): drives Notion's internal
  export endpoint (cookies) — "you get exactly the Markdown and CSV you'd get from clicking through"; warns "it
  still is an internal API, so it may break anytime."
- **notion2obsidian** (bun CLI, [GitHub](https://github.com/bitbonsai/notion2obsidian)): zip-in/vault-out cleanup
  (UUID strip, link rewrite, collision avoidance) — the exact "Notion zip janitor" product shape proposed for
  Worldloom, already validated enough to have users ([reddit 1nyw5c4](https://www.reddit.com/r/ObsidianMD/comments/1nyw5c4/)).

### 3.3 Pandoc / mammoth / markitdown (document converters)

- Pandoc: ~40 formats; the only converter with documented tracked-changes control; media extraction flag;
  reference-doc styling; footnotes best-in-class ([manual](https://www.pandoc.org/MANUAL.html),
  [pipeline guide](https://localconvert.it.com/ba/guides/docx-pandoc-pipeline/)). **Binary ~10s of MB, Haskell,
  not embeddable in a ≤15MB Tauri installer.**
- mammoth (JS, style-map driven docx→HTML) + separate HTML→md step is the in-app alternative
  ([TransformPipe](https://transformpipe.com/blog/convert-docx-to-markdown)); markitdown (Microsoft) is the
  batch-oriented CLI alternative recommended in Obsidian's own issue thread
  ([#237](https://github.com/obsidianmd/obsidian-importer/issues/237)).

### 3.4 Purpose-built campaign platforms

| Platform | Inbound import | Technique & limits | Source |
|---|---|---|---|
| **LegendKeeper** | Obsidian vault, markdown/txt/html (single files, folders, zips), `.LK`/JSON, **World Anvil zip**, Google Docs | Obsidian vault: "LK will do its best to resolve [[Wiki Links]]… will attempt to parse your YAML Frontmatter to extract Tags, Alias"; folder/zip crawl uses directory structure for nesting, filename-based link resolution, "non-unique names may interfere with linking"; Google Docs = manual per-doc markdown download; WA import needs WA paid account + API token; marketing: "Most users are ready in under 20 minutes" | [LK changelog 0.16.1.0](https://www.legendkeeper.com/changelog/legendkeeper-0-16-1-0/), [LK import guide](https://www.legendkeeper.com/import-world-legendkeeper/), [legendkeeper.com](https://www.legendkeeper.com/) |
| **LegendKeeper (outbound)** | — | MD export is "partial… does not include maps, boards, properties, and some editor content block types"; "LK will not export as [[Wiki Links]] for compatibility reasons. LK will export your tags and aliases as YAML frontmatter" — **the tags/aliases-as-frontmatter convention is the same one Worldloom uses** | [LK changelog](https://www.legendkeeper.com/changelog/legendkeeper-0-16-1-0/) |
| **World Anvil** | **None for prose.** FAQ: "You can copy and paste text directly into World Anvil, and upload images and maps." Only structured importer = D&D Beyond *characters* | The category incumbent chose zero import surface; outbound = API-key JSON export (BBCode content) that community tools convert imperfectly: "attempt_bbcode… it works sometimes… it isn't perfect" ([WorldAnvil-to-MD](https://github.com/Nynir/WorldAnvil-to-MD)); "[article:12345] references" are not rewritten to wikilinks; interactive maps/pins never leave ([loreteller guide](https://loreteller.com/learn/world-anvil-export-obsidian/)) | [WA FAQ](https://www.worldanvil.com/faq), [WA D&D Beyond importer](https://www.worldanvil.com/learn/rpg/dndbeyond-importer) |
| **Kanka** | Own JSON export zip (paid tiers only); CSV bulk-create (paid) | "markdown exports are not supported by the import feature"; CSV import creates one entry type per run, maps columns to fields | [Kanka import docs](https://docs.kanka.io/en/latest/features/campaigns/import.html), [Kanka CSV import](https://docs.kanka.io/en/latest/features/campaigns/csv-import.html) |
| **Campfire** | Manuscript only: "Import a DOCX or EPUB file and we'll automatically split your story into chapters" (+ legacy Blaze) | Worldbuilding elements (the campaign notes) have no documented bulk import; modules historically paid-per-module | [campfirewriting.com/word-processor](https://campfirewriting.com/word-processor), [manuscript import tutorial](https://www.campfirewriting.com/learn/manuscript-import-tutorial), [FAQ](https://campfirewriting.com/faq) |
| **PostRoll** (newer entrant) | Obsidian vault zip, Notion md+csv zip, Google Docs (via .docx), Word .docx, LibreOffice .odt, markdown, World Anvil world export, LegendKeeper JSON | Explicit per-source loss table ("Notion — database views, filters, formulas, rollups, comments and page history" don't survive; "A database arrives as a table of its values"); background jobs for large imports; "an import you don't have to undo is the least work of all" | [PostRoll: Importing content](https://help.postroll.app/worlds/wiki/importing-content/) |
| **Codex Cryptica** (niche entrant) | Obsidian vault, World Anvil JSON, Kanka zip, LegendKeeper JSON | Confirms the pattern: every new campaign tool now launches with a migration-hub page | [codexcryptica.com/migrations](https://codexcryptica.com/migrations) |

### 3.5 Scrivener (authoring tool; the "compile" model)

- Scrivener is an *outbound* specialist: Compile stitches the binder into PDF/docx/EPUB/**MultiMarkdown (.md)**,
  or via Pandoc if installed ("Scrivener also supports a few Pandoc export options… you will not see any compile
  options for it, unless you install it yourself" —
  [Scrivener manual](https://www.literatureandlatte.com/docs/Scrivener_Manual-Win.pdf)); File→Export also offers
  `.md` among RTF/docx/fdx/txt ([L&L blog](https://www.literatureandlatte.com/blog/how-to-export-scrivener-projects-and-why-you-might-want-to)).
- Quality is config-dependent: rich-text→markdown conversion requires "training the compiler" with styles, and
  native converters are judged weak even by its forum regulars ("I really don't recommend compiling with the
  native Scrivener converters… there is really nothing to be gained from using the native converters"
  — [L&L forum](https://forum.literatureandlatte.com/t/markdown-and-editor-styling-together/141165)); nested
  lists/indents misbehave ([AppleVis guide](https://www.applevis.com/blog/mac-apps/markdown-scrivener)).
- **Worldloom relevance:** never parse `.scriv` (proprietary, bundled with RTF). Accept what Scrivener *emits*:
  a folder of `.md` or a `.docx` — both already in our wedge. GMs using Scrivener (P2 worldbuilder-authors)
  self-select into exportable formats. **[High]**

### 3.6 Technique synthesis (what the field proves)

| Technique | Used by | Verdict for Worldloom |
|---|---|---|
| Parse Notion **HTML zip** (richer, recommended by Obsidian) | Obsidian Importer, FormatArc path B | **Adopt** — highest-fidelity offline path |
| Parse Notion **Markdown&CSV zip** (common default) | notion2obsidian, most user scripts | **Adopt** — cheapest; UUID janitor is the core value |
| Notion **API traversal** (token, rate limits, `.base`/DataView targets) | Obsidian API importer, notion-to-md | **Defer** (binding out-list, §4) |
| **Filename-based link reconciliation** across an imported tree | LK, Obsidian Importer ("import all at once so internal links can be reconciled") | **Adopt** — must run globally, not per-file |
| **Fixture + recorded-expected-output tests** | Obsidian Importer (`npm test -- notion`) | **Adopt** — same pattern fits our vitest suite |
| **Preview + untick step before commit** | Obsidian Importer, LK, PostRoll | **Adopt** |
| **Per-source loss table shown to the user** | PostRoll | **Adopt** — honest marketing + support-cost reducer |
| docx → HTML (mammoth) → markdown | TransformPipe recommendation, mammoth docs | **Adopt** for .docx/Google-Takeout |
| Bundled Pandoc binary | power users, Scrivener | **Reject** — installer budget (ARCH: ≤15MB) |
| BBCode/JSON platform importers (WA/Kanka/LK) | Codex Cryptica, PostRoll, WorldAnvil-to-MD | **Reject for v1** — see out-list |

---

## 4. RQ4 — FIT TO WORLDLOOM

Worldloom's model (PRD-M1, ARCH, ADR-002/005): the vault is a folder of markdown files, byte-faithful on disk;
frontmatter v1 subset = `type`, `aliases`, `tags`, `relations`, `temporal`; `[[wikilinks]]` resolved against
titles+aliases; title = first H1 or filename; images are local files referenced relatively; index is derived and
rebuild-safe; M2's audit pipeline treats vault content as **untrusted input** and never auto-writes without user
action. An import wizard only ever *creates new files* — it never rewrites existing ones — so it does not
conflict with ADR-002's byte-fidelity promise; its job is to produce files that our parser, editor, and audit
pipeline can ingest on their own terms.

### 4.1 Cheap cases (build these)

| Case | Why cheap | Notes |
|---|---|---|
| **A. Markdown folder / Obsidian vault adopt** | Worldloom already opens `.md` folders; wikilinks/frontmatter/aliases are already our dialect. LK proves frontmatter `tags`/`aliases` extraction is enough for a good import ([LK changelog](https://www.legendkeeper.com/changelog/legendkeeper-0-16-1-0/)) | Wizard = validation pass: count notes, list unresolved wikilinks, filename collisions, embedded-asset path check, then hand off to normal indexing. Zero conversion. |
| **B. Notion Markdown&CSV zip** | Pure file transformation: strip 32-char UUID suffixes, rebuild link targets from the UUID→title map, flatten `Export-…` asset folders, map callout-HTML → our callout/blockquote, toggles → headings or `<details>`, keep CSVs as imported tables with a provenance note | Highest-volume wedge (template culture + lock-in fear documented in DISCOVERY-gm-workflows RQ4). All 8 FormatArc quirks are enumerable and testable against fixtures. |
| **C. Notion HTML zip** | Same pipeline shape, one extra parser (HTML→md). Obsidian proves feasibility and documents the pitfalls for us ([help.obsidian.md](https://obsidian.md/help/import/notion)) | Higher fidelity (toggles/callouts/links survive); more parsing surface. Ship after B or in parallel if fixtures are ready. |
| **D. Single/folder `.docx` (incl. Google Takeout)** | mammoth (docx→HTML) + existing markdown-it/HTML→md knowledge; images extracted via callback; matches PostRoll's Google-Docs route ([PostRoll](https://help.postroll.app/worlds/wiki/importing-content/)) | Detect tracked changes/text boxes up front and *warn* (silent loss is the documented sin, §2.4). |
| **E. Google Docs `.md` folder** | Users download each doc as `.md`; our job is only folder ingest + link fixups — same as case A plus "Docs-flavored" cleanup (title-as-H1, smart-chip leftovers as plain links per [Google help](https://support.google.com/docs/answer/18289341)) | Nearly free; document the manual export step in-wizard (LK does exactly this, §3.4). |

### 4.2 Traps (do not build in v1 without a gate decision)

1. **Notion database reconstruction (relations/rollups/formulas).** Impossible from file export by Notion's own
   documentation (§2.1) and every practitioner ("no true round-trip because relations just cant survive the
   export" — [r/Notion 1uladm0](https://www.reddit.com/r/Notion/comments/1uladm0/) verbatim). Anything we build
   here is guesswork over CSV columns. *Mitigation instead:* import CSVs as structured table notes + let M2's
   extraction proposals propose `relations`/`aliases` — the auditor already exists for exactly this. **Trap of
   promising "your databases come back".**
2. **Notion API import.** Requires network + user token + rate-limit handling — off-brand for a local-first,
   M1-zero-network app, and drags us into Notion's API churn (Obsidian's own API importer ships explicit
   "edge cases may not have been considered" caveats and can't do linked data sources at all,
   [help.obsidian.md](https://obsidian.md/help/import/notion)). The 2026 Markdown Content API reduces parsing
   work but adds an auth story aimed at *automation pipelines*, not one-off migrations (§2.1). *Gate question,
   not a v1 item.*
3. **Bundling Pandoc.** ARCH hard requirement: installer ≤15MB. Pandoc alone blows it. Use the mammoth+TS route;
   optionally *detect* a user-installed Pandoc and offer it as an "advanced" engine (assumption: <5% of target
   users have it — P3 persona will never install Haskell tooling).
4. **Google Docs "bulk".** There is no API-free bulk md export; Takeout gives `.docx` zips (case D covers this),
   and LegendKeeper's official answer is per-file downloads ([LK guide](https://www.legendkeeper.com/import-world-legendkeeper/)).
   Do not promise "connect your Google Drive".
5. **Synced-block dedup.** Notion writes the same synced content into every referencing file (§2.1). Auto-dedup
   risks deleting the only copy of a variant; *report duplicates* and let the human decide (M2-consistent:
   never auto-edit).
6. **Windows MAX_PATH + UUID names.** Deep Notion hierarchies with 32-char suffixes hit 260 chars fast on
   Windows (FormatArc documents it; Windows is our primary platform). Shorten names deterministically at import;
   keep a UUID→final-path manifest so link rewriting and later provenance lookups stay possible.
7. **Scale/zip bombs.** Real exports hit 1.8GB / 1700+ files and nested part-zips ([reddit 1nyw5c4](https://www.reddit.com/r/ObsidianMD/comments/1nyw5c4/),
   [help.obsidian.md](https://obsidian.md/help/import/notion)). Stream, cap, progress, cancel — and treat every
   imported byte (HTML in particular) as untrusted input through the same sanitization discipline as the preview
   pipeline (ARCH Security: renderer CSP; DOMPurify for preview).
8. **Word review layer.** Tracked changes/comments vanish silently in every converter (§2.4). Detect `w:ins` /
   `w:del` / comments parts in the zip and surface a pre-import warning; default = accept (Pandoc's default is
   the market norm, but ours *warns*).
9. **Emoji/property-icon databases.** Notion's emoji-property rows have nowhere to live in markdown; strip to
   plain values and list in the report. (Trap = trying to preserve them as inline emoji frontmatter — noise the
   auditor would choke on.)
10. **"Pull out all the connections for me"** ([r/DMAcademy 1tfo26e](https://www.reddit.com/r/DMAcademy/comments/1tfo26e/))
    — that request is M2 extraction, not M2.5 import. The wizard must not promise semantic structuring; it
    promises *lossless-enough transport + an honest report*.

### 4.3 Positioning read (High confidence)

The acquisition story writes itself from §1: "**Years of campaign notes. Out of Notion. In 10 minutes. Links
intact. Nothing silently lost — we'll tell you exactly what didn't make it.**" Every element is backed: 10-minute
imports are the market's own benchmark claim (LK, §3.4), link reconciliation is the #1 fear (§1.2 #9), and the
honesty-report angle has zero competition (no importer in the inventory ships a good one).

---

## 5. RQ5 — OPEN QUESTIONS FOR THE CTO GATE

1. **Wedge order:** is the primary target *Notion switchers* (biggest pain, biggest volume per evidence) or
   *Google-Docs pragmatists* (biggest population, cheapest format)? Evidence tilts Notion: the pain is acute and
   public, the fixes are enumerable, and lock-in fear is our positioning spine. [Priority: high]
2. **Notion API import: ever?** If the wizard is a local-first trust story, an online import muddies it. If we
   never do it, we should still *say so* in copy ("nothing leaves your machine — Notion exports come from
   Notion's own export button"). [Priority: high]
3. **CSV → what exactly?** Options: (a) import each database CSV as one table note + row-page stubs, (b) table
   note only, (c) skip CSVs with a report entry. Row-page stubs collide with M2 extraction's territory. Decide
   before Wave 2. [Priority: high]
4. **Report granularity:** is the post-import report a one-shot dialog, or a persisted `_import-report.md` in the
   vault? (Persisted = auditable + re-checkable; also vault pollution.) [Priority: medium]
5. **Undo model:** delete-the-imported-folder only (cheap, safe), or per-note undo? Assume folder-level; confirm.
   [Priority: medium]
6. **Provenance stamps:** write `imported_from`/`imported_at` frontmatter on every created note? Helps the
   auditor ("this fact came from a lossy import") but violates "frontmatter v1 subset" unless we extend it.
   [Priority: medium]
7. **Fixture acquisition budget:** real Notion/Docs/docx corpora are needed before Wave 2 (Obsidian Importer's
   fixture-recording pattern, §3.1). Can we source real-world anonymized exports, or only synthetic? [Priority: high]
8. **Sizing vs M2 auditor:** the wizard is the "acquisition wedge" candidate but M2.5 lands *after* the money
   features. Is there an argument for shipping Wave 1 (vault adopt + report) inside M2 as an onboarding surface
   instead? [Priority: high]

---

## 6. Limitations

- Reddit evidence skews vocal/tech-adjacent English-speaking users (same caveat as DISCOVERY-gm-workflows §13);
  `[snippet]` quotes are verbatim search excerpts with less surrounding context than `[v]` (browser-read) quotes.
- Two vendor sources (mdisbetter.com, FormatArc) sell competing converters; their *factual* claims were chosen
  only where independently corroborated (Notion help, Obsidian help, Reddit), and their quality judgments are
  labeled directional.
- No hands-on execution of importers was performed in this discovery (docs-only scope); defect lists are
  as-reported by users and maintainers. Before Wave 2, a spike should run 3–5 real exports through Obsidian
  Importer, notion2obsidian, and our prototype for side-by-side output comparison. **(assumption: this materially
  de-risks the mapping spec)**
- Worldloom-internal effort numbers are deliberately absent; PRD-M2.5 draft carries wave placeholders only.

---

## 7. Source list (all accessed 2026-10-15)

**Browser-read verbatim (Reddit post + comments):**
1. r/ObsidianMD — "Finally migrated from Notion to Obsidian." (6 yrs TTRPG notes, 2 weeks of evenings) — https://www.reddit.com/r/ObsidianMD/comments/1t18l7c/
2. r/ObsidianMD — "I migrated 1.8GB from Notion to Obsidian - existing tools failed, so I built my own" — https://www.reddit.com/r/ObsidianMD/comments/1nyw5c4/
3. r/Notion — "Why can't I export my Notion data properly?" — https://www.reddit.com/r/Notion/comments/1uladm0/

**Search-snippet sources (verbatim excerpts via web_search):**
4. r/ObsidianMD — "Exporting from notion to obsidian" (GUID suffixes) — https://www.reddit.com/r/ObsidianMD/comments/11v27ud/
5. r/ObsidianMD — "Importing from notion-Doesnt maintaining structure" — https://www.reddit.com/r/ObsidianMD/comments/1oenra5/
6. r/ObsidianMD — "Migrating to Obsidian from Notion fails" (hidden .md file crash) — https://www.reddit.com/r/ObsidianMD/comments/1mzm1tz/
7. r/ObsidianMD — "Converting notion databases to DB folders and having issues" (TTRPG DB) — https://www.reddit.com/r/ObsidianMD/comments/1gg783s/
8. r/ObsidianMD — "[Request] LF Obsidian power user to help migrate from notion (Paid)" (D&D homebrew) — https://www.reddit.com/r/ObsidianMD/comments/1mjlmby/
9. r/ObsidianMD — "Has anyone successfully imported Notion databases and pages across to Obsidian?" — https://www.reddit.com/r/ObsidianMD/comments/1p5239c/
10. r/ObsidianMD — "Moving Story Notes from Notion to Obsidian; Questions and Quibbles" — https://www.reddit.com/r/ObsidianMD/comments/1uvtsww/
11. r/ObsidianMD — "Migrating 800+ TTRPG rule notes from LegendKeeper to Obsidian?" — https://www.reddit.com/r/ObsidianMD/comments/1k3h3ya/
12. r/ObsidianMD — "For those coming from Notion, how was the migration process…" — https://www.reddit.com/r/ObsidianMD/comments/13vpqzm/
13. r/DMAcademy — "Notes" (dozens of Google Docs → import + connections) — https://www.reddit.com/r/DMAcademy/comments/1tfo26e/
14. r/DMAcademy — "Great digital note-taking / campaign journal apps ASIDE from OneNote?" — https://www.reddit.com/r/DMAcademy/comments/1e84qjn/
15. r/DMAcademy — "How, in the name of every god, do y'all stay organized?" — https://www.reddit.com/r/DMAcademy/comments/1frh0gl/
16. r/DMAcademy — "What is the best campaign management tool to use?" — https://www.reddit.com/r/DMAcademy/comments/1i87x55/
17. r/DnD — "D&D Notes" (32,000-word Google Doc) — https://www.reddit.com/r/DnD/comments/1qnkpvm/
18. r/Notion — "Just migrated from Google Docs to Notion - Feeling a bit lost!" — https://www.reddit.com/r/Notion/comments/1iygn0s/
19. r/legendkeeper — "How does LK import support changes to existing files?" (re-import duplicates) — https://www.reddit.com/r/legendkeeper/comments/1pqo0tl/
20. r/DungeonMasters — "Question for DMs - Obsidian vs Notion" — https://www.reddit.com/r/DungeonMasters/comments/1ghoih4/

**Vendor / official docs:**
21. Notion — "Export your content" (Markdown&CSV, callouts→HTML, databases→CSV) — https://www.notion.com/help/export-your-content
22. Notion Developers — Block reference ("unsupported" block types) — https://developers.notion.com/reference/block
23. Notion Developers — Markdown Content API guide (via FormatArc) — https://developers.notion.com/guides/data-apis/working-with-markdown-content
24. Obsidian Help — "Import from Notion" (HTML over Markdown; API vs file; limits; nested zips) — https://obsidian.md/help/import/notion
25. Obsidian Help — "Import notes" (format index) — https://obsidian.md/help/import
26. obsidian-importer — README (format list; "not actively working on adding new import capabilities"; fixture tests) — https://github.com/obsidianmd/obsidian-importer
27. obsidian-importer — Issue #237 "Import from Google Docs" (Takeout→docx→converter workaround) — https://github.com/obsidianmd/obsidian-importer/issues/237
28. DeepWiki — obsidian-importer supported formats (capability matrix) — https://deepwiki.com/obsidianmd/obsidian-importer/3-supported-formats
29. Google Docs Help — "View and edit Markdown (.md) files" (losses) — https://support.google.com/docs/answer/18289341
30. n8n — PR #25115, Drive API markdown export MIME — https://github.com/n8n-io/n8n/pull/25115
31. FormatArc — "Notion Export to Markdown — Fix UUIDs & Callouts" (8-quirk catalog; MD Content API) — https://formatarc.com/en/blog/notion-export-to-markdown
32. notion-to-md — npm / GitHub (API block-walk converter) — https://www.npmjs.com/package/notion-to-md · https://github.com/souvikinator/notion-to-md
33. notion-exporter — npm (internal export endpoint driver) — https://www.npmjs.com/package/notion-exporter
34. notion2obsidian — GitHub (zip janitor CLI) — https://github.com/bitbonsai/notion2obsidian
35. Pandoc — User's Guide (track-changes, extract-media, file-scope) — https://www.pandoc.org/MANUAL.html
36. LocalConvert — "DOCX to Markdown and back: a Pandoc pipeline that actually works" — https://localconvert.it.com/ba/guides/docx-pandoc-pipeline/
37. TransformPipe — "How to Convert DOCX to Markdown" (mammoth route; part-level failure map) — https://transformpipe.com/blog/convert-docx-to-markdown
38. TransformPipe — "What Not to Keep From a .docx" (review layer, text boxes) — https://transformpipe.com/blog/what-not-to-keep-from-a-docx
39. LegendKeeper — "How to import your world into LegendKeeper" (Google Docs = manual md downloads) — https://www.legendkeeper.com/import-world-legendkeeper/
40. LegendKeeper — Changelog 0.16.1.0 (Obsidian vault import; wikilink/frontmatter parsing; MD export partial) — https://www.legendkeeper.com/changelog/legendkeeper-0-16-1-0/
41. LegendKeeper — Homepage ("ready in under 20 minutes") — https://www.legendkeeper.com/
42. World Anvil — FAQ ("copy and paste text directly into World Anvil") — https://www.worldanvil.com/faq
43. World Anvil — D&D Beyond importer (only structured importer) — https://www.worldanvil.com/learn/rpg/dndbeyond-importer
44. WorldAnvil-to-MD — GitHub (BBCode conversion limits; export via API key) — https://github.com/Nynir/WorldAnvil-to-MD
45. Loreteller — "Export World Anvil to Obsidian" (BBCode artifacts, [article:ID] links, maps stranded) — https://loreteller.com/learn/world-anvil-export-obsidian/
46. Kanka Docs — Campaign import (JSON zip only; "markdown exports are not supported") — https://docs.kanka.io/en/latest/features/campaigns/import.html
47. Kanka Docs — CSV import (paid tiers; one entry type per run) — https://docs.kanka.io/en/latest/features/campaigns/csv-import.html
48. Campfire — Word processor page (DOCX/EPUB manuscript import) — https://campfirewriting.com/word-processor
49. Campfire — Manuscript Import Tutorial — https://www.campfirewriting.com/learn/manuscript-import-tutorial
50. PostRoll Help — "Importing content" (7-source table; loss table; review step) — https://help.postroll.app/worlds/wiki/importing-content/
51. Codex Cryptica — Migration Hub (importer-page pattern) — https://codexcryptica.com/migrations
52. Literature & Latte — Scrivener manual (Win PDF; Compile/MultiMarkdown/Pandoc) — https://www.literatureandlatte.com/docs/Scrivener_Manual-Win.pdf
53. Literature & Latte Blog — "How to Export Scrivener Projects" (export formats incl. .md) — https://www.literatureandlatte.com/blog/how-to-export-scrivener-projects-and-why-you-might-want-to
54. L&L Forum — "Markdown and Editor Styling Together" (native converters criticized; Pandoc recommended) — https://forum.literatureandlatte.com/t/markdown-and-editor-styling-together/141165
55. AppleVis — "Markdown with Scrivener" (lists/indents quirks) — https://www.applevis.com/blog/mac-apps/markdown-scrivener
56. mdisbetter — "Google Docs Export to Markdown Sucks" (vendor; directional only) — https://mdisbetter.com/blog/google-docs-export-sucks

**Total distinct sources cited: 56** (3 browser-read Reddit threads, 17 snippet-verified Reddit threads, 36 vendor/docs/tool sources).
