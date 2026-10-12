# DISCOVERY — Word-like editing over Markdown: editor reveal rules & lossless building blocks

**Date:** 2026-10-12 · **Status:** research complete (Technical UX research, pre-implementation)
**Scope:** How reference editors (Typora, Obsidian Live Preview, iA Writer, Zettlr, Bear, Notion/Craft) decide
*when raw markdown syntax is visible*, and which open-source building blocks can reproduce that over
**raw markdown bytes** (ADR-002: the file is the user's property; ADR-005: live preview = CM6 + decorations,
reveal on the construct under the cursor).
**Method:** ≥26 web searches + direct extraction of vendor docs, GitHub/npm/Bundlephobia APIs. Every factual
claim is linked; version-sensitive facts are stamped with the version/date verified (all **2026-10-12** unless noted).

---

## 0. TL;DR

1. **The reference rule is construct-scoped reveal, gated on the caret (not the selection).** Typora hides
   inline markers "smartly" and hides block markers once the block is rendered ([Typora Quick Start](https://support.typora.io/Quick-Start/));
   Obsidian Live Preview reveals syntax "when your cursor enters formatted content"
   ([Obsidian Help](https://obsidian.md/help/edit-and-read)); Bear is the outlier that reveals when the
   *word is selected* ([Bear 2 announcement](https://blog.bear.app/2023/07/bear-2-is-here/)). **No reference
   editor reveals syntax for a merely-selected region**, and none reveals whole selected lines — the
   CTO's "two views only, feel like Word" direction matches the market.
2. **Every editor that keeps this promise stores raw markdown (or raw rich text) and paints the other
   view over it.** Typora even exposes its mechanism in theming docs: inline delimiters live in `.md-meta`
   spans and are *hidden by CSS* ([Typora Typesetting](https://support.typora.io/Typeset/)) — i.e. the
   document is the source; the reveal is presentation. This is exactly Worldloom's CM6 model.
3. **All ProseMirror/Tiptap "markdown editors" serialize on save, and their serializers rewrite user bytes.**
   Concrete, recent evidence: Tiptap's new official `@tiptap/markdown` is explicitly **beta** with a
   fresh (Oct 2026, v3.31.x) stream of round-trip bug reports — over-escaping, entities in link hrefs,
   dropped indented code fences, list-nesting level changes
   ([docs](https://tiptap.dev/docs/editor/markdown), [issues #8471](https://github.com/ueberdosis/tiptap/issues/8471),
   [#8468](https://github.com/ueberdosis/tiptap/issues/8468), [#8460](https://github.com/ueberdosis/tiptap/issues/8460),
   [#8472](https://github.com/ueberdosis/tiptap/issues/8472)); the community `tiptap-markdown` is
   deprecated with 25 open issues of mangled output (tables, task lists, escaped bullets…); Milkdown had a
   serializer bug that "can silently corrupt formatting into literal" text
   ([#2403](https://github.com/Milkdown/milkdown/issues/2403), closed 2026-07-02).
4. **Recommendation: refine the existing CM6 decoration engine to construct-scoped reveal; adopt no
   framework.** ~2–4 focused weeks; the alternatives all break ADR-002's byte-fidelity promise or are
   abandoned (Toast UI archived, ByteMD dormant). Details in §5.

---

## 1. RQ1 — Exactly when do reference editors reveal raw markdown?

### 1.1 Typora (WYSIWYM, hybrid editing; closed source, v1.x — verified docs 2026)

- Official description: "Typora uses the feature: *Live Preview* … you can see inline styles as soon as you
  finish typing them and see block styles as you type or after you press the Enter key… **Markdown tags for
  inline styles, such as `**` will be hidden or displayed smartly. Markdown tags for block level styles, such
  as `###` or `- [x]` will be hidden once the block is rendered.**"
  ([Quick Start](https://support.typora.io/Quick-Start/), updated 2026-09-06)
- **Granularity:** inline constructs reveal their delimiters only while the caret is inside that inline
  span ("displayed smartly"); block constructs reveal while you are editing *that block* and hide again when
  the block loses focus (Enter → next paragraph). Typora 1.13's changelog (2026-04-03) calls the default
  mode **"hybrid editing mode"** and keeps a separate **"source code mode"** (two modes only)
  ([What's New 1.13](https://support.typora.io/What's-New-1.13/)).
- **Implementation leak:** themes can defeat hiding with two CSS rules —
  `.md-meta, .md-content { display: inline; }` — proving delimiters are stored as inline meta spans in the
  document and hidden by presentation ([Typesetting with CSS](https://support.typora.io/Typeset/)).
- **Selection:** selection alone does not switch a construct to source; you must be editing inside it
  (the block you're editing shows its markers). Users repeatedly describe this as "when your cursor touches
  text, the syntax appears" (e.g. [r/Markdown thread, 2026-07-20](https://www.reddit.com/r/Markdown/comments/1v0qd3b/so_there_is_no_true_wysiwyg_markdown_editor_they/)).
- No line numbers, no formatting toolbar by default (native menus/shortcuts), WYSIWYG table editing,
  Focus/Typewriter modes ([Focus & Typewriter](https://support.typora.io/Focus-and-Typewriter-Mode/)).

### 1.2 Obsidian Live Preview (CM6; the closest model to Worldloom)

- Official behavior: "**Live Preview** shows formatted text inline while hiding most Markdown syntax.
  **When your cursor enters formatted content, the underlying syntax becomes visible for editing.**"
  **Source mode** "displays all Markdown syntax exactly as written." Toggled with `Ctrl/Cmd+E`
  ([Views and editing mode](https://obsidian.md/help/edit-and-read)).
- **Granularity (as implemented and as reimplemented by the community):**
  - Inline marks (`**`, `*`, `` ` ``, links): reveal **only the inline node containing the caret** — the
    span itself, not the line. Community CM6 reimplementations state this explicitly: "Raw markdown shows
    at cursor position only" ([antigravity-live-preview README](https://github.com/Rauglothgor/antigravity-live-preview));
    "the raw syntax appears only on the line your cursor is on, then tucks itself away when you move on"
    ([atomic-editor README](https://github.com/kenforthewin/atomic-editor), a React CM6 editor explicitly
    modeled on Obsidian).
  - Block marks (heading `#`, list `-`/`>`, frontmatter `---`): the **block containing the caret** reveals
    its markers; other blocks stay rendered. The Milkdown team describes the target behavior as
    "always display markdown syntax of **block at cursor position**, similar to Typora/Obsidian/Vditor"
    ([Milkdown #645](https://github.com/Milkdown/milkdown/issues/645)).
  - **Selection reveals nothing by itself** — reveal is keyed to caret position, not to selected lines.
    Obsidian renders around the selection; you do not get raw bytes for a selected region. *(Obsidian does
    not publish the precise predicate; the above is corroborated by its own docs wording "cursor enters",
    by the Milkdown #645 framing, and by every community reimplementation. Before shipping, pin the exact
    predicate with a 30-minute hands-on pass against Obsidian v1.x — treat as an open verification task.)*
  - A CM6 practitioner thread notes Obsidian renders "by blocks of wrappers" while his extension renders
    per-line, "which makes the layout shifts less annoying"
    ([discuss.codemirror.net #9660, 2026](https://discuss.codemirror.net/t/9660)) — granularity choice is a
    real, discussed design axis, not an implementation detail.
- **Editor chrome:** line numbers are an explicit opt-in setting; "Readable line length" caps measure;
  indentation guides and frontmatter ("Properties in document", incl. *source* view) are separate settings
  ([Settings](https://obsidian.md/help/settings)). List bullets are replaced by widgets (rendered `•` +
  indent guides) — see the official plugin recipe below (§4.2). No formatting toolbar (auto-pair Markdown
  syntax + commands instead). Tables in Live Preview render but editing happens in the pipe-syntax
  (block reveals when caret is inside).

### 1.3 iA Writer (styled source + separate preview — *no* inline reveal)

- The **Editor shows the markdown source** (styled): "Wikilinks are enclosed in double square brackets
  `[[your link here]]` **in Editor** and shown as regular links **in Preview**"
  ([iA Writer Wikilinks](https://ia.net/writer/support/library/wikilinks)).
- Rendering is a separate mode: Preview, export, print. Wikilink/hashtag output is independently
  configurable per target (source text vs `<span>` vs link)
  ([Settings → Wikilinks, Hashtags, Autolinks](https://ia.net/writer/support/basics/settings)).
- Differentiation axes are Focus Mode (sentence/paragraph/**typewriter**), Syntax Highlight (parts of
  **speech** coloring, editor-only, not markdown syntax), Style Check
  ([Syntax Highlight](https://ia.net/writer/support/editor/syntax-highlight),
  [Settings](https://ia.net/writer/support/basics/settings)). Optional toolbar (always/never/fade),
  line-length limit 64/72/80, no line numbers.
- **Takeaway for Worldloom:** iA Writer proves the *opposite* pole — syntax visible while writing, fidelity
  guaranteed by never hiding anything. Its users are professional writers who accept visible syntax; the
  GM/note-taking audience we target expects Obsidian/Typora behavior instead.

### 1.4 Zettlr (CM6 since v3/v4; explicit WYSIWYG ⇄ WYSIWYM switch)

- Zettlr renders markdown **in place** and exposes the choice per element type: "you can in general choose
  between **WYSIWYG** … and **WYSIWYM** … If you select the 'Preview mode' you can then specify which
  elements shall be pre-rendered" (checkboxes per construct), plus a **statusbar "Rendering" item to
  toggle immediately** ([Zettlr docs → Appearance](https://docs.zettlr.com/en/editor/appearance.html)).
- Zettlr's docs state the honest constraint Worldloom also faces: preview "is only an approximation … you
  still need to be able to edit the file. If we were to produce a truthful representation … we would also
  need to sometimes collapse linebreaks, move elements around… We can't do this without introducing the
  risk of potential data loss" (same page).
- Implementation: **CodeMirror 6** — v4.8.0 `package.json` pins `@codemirror/view ^6.43.11`,
  `@codemirror/lang-markdown ^6.5.2`, etc. ([Zettlr repo](https://github.com/Zettlr/Zettlr), verified
  2026-10-12; GPL-3.0, 13.7k stars, active). Note Zettlr chose *element-type toggles* (render images but not
  citations) rather than cursor-scoped reveal — a less Word-like, more power-user model.
- Reveal granularity in preview mode: markers of non-rendered elements stay visible; there is no
  caret-scoped reveal. Line numbers optional (editor setting); no toolbar; tables rendered-but-source-edit.

### 1.5 Bear 2 (hide-markdown toggle; **selection-gated** reveal)

- "**Hide Markdown** – Formatting markup now hides for a cleaner look and easier reading. For example, the
  asterisks for **bold** will be hidden but **will appear for editing when the word is selected**"
  ([Bear 2 is here!, 2023-07-11](https://blog.bear.app/2023/07/bear-2-is-here/)).
- User-controllable: "You can choose to hide or show Markdown style characters by toggling the **Hide
  Markdown** option in `Settings > General`"; CommonMark-based; formatting bar (**B** *I* ~U~ button) and
  ⌘B/⌘I/⌘U/⌘⇧M shortcuts; nested styles export caveat
  ([Bear FAQ — How to use Markdown in Bear](https://bear.app/faq/how-to-use-markdown-in-bear/)).
- **This is the one reference editor where selection reveals syntax** — and notably it reveals when the
  *styled run* is selected, not when arbitrary lines are selected. Tables have a visual editor; WikiLinks
  `[[`; footnotes; YAML (Bear 2 announcement). No line numbers, no per-construct source view.

### 1.6 Behavior table

| Editor | Reveals on selection? | Reveals on caret inside construct? | Line numbers | Bullet rendering | Toolbar model | Table editing |
|---|---|---|---|---|---|---|
| **Typora** (v1.x, hybrid) | No (editing inside block yes) | Yes — inline spans "smartly"; block markers while that block is active ([Quick Start](https://support.typora.io/Quick-Start/)) | No | Rendered glyphs | None by default (menus/shortcuts) | WYSIWYG in-place |
| **Obsidian Live Preview** | No (caret-keyed) | Yes — inline node with caret; block containing caret ([Help](https://obsidian.md/help/edit-and-read), [Milkdown #645](https://github.com/Milkdown/milkdown/issues/645)) | Opt-in setting ([Settings](https://obsidian.md/help/settings)) | `•` widget + indent guides ([dev docs](https://docs.obsidian.md/Plugins/Editor/Decorations)) | None (auto-pair + commands) | Pipe source reveals when caret in table |
| **iA Writer** | n/a — editor = source | Never hides in editor; Preview is separate ([Wikilinks](https://ia.net/writer/support/library/wikilinks)) | No | Source `-` visible, styled | Optional fading toolbar ([Settings](https://ia.net/writer/support/basics/settings)) | Source syntax |
| **Zettlr** (v4.8, CM6) | No | No caret-scoped reveal; per-element WYSIWYG/WYSIWYM toggles + statusbar switch ([docs](https://docs.zettlr.com/en/editor/appearance.html)) | Setting | Rendered when element "preview" enabled | None | Rendered preview, source edit |
| **Bear 2** | **Yes** — markers appear when the styled run/word is selected ([blog](https://blog.bear.app/2023/07/bear-2-is-here/)) | Implicitly (caret in word = selected word) | No | Rendered glyphs | **B _I_ ~U~ format bar** + ⌘B… ([FAQ](https://bear.app/faq/how-to-use-markdown-in-bear/)) | Visual table editor |
| **Notion** | n/a (rich model) | n/a — markdown is input-only (converts on type) | No | Rendered `•` block | Selection popup toolbar + slash menu ([Help](https://www.notion.com/help/writing-and-editing-basics)) | Full block table |
| **Craft** | n/a (rich model) | n/a — markdown is input-only | No | Rendered glyphs | Selection formatting toolbar + `Aa` panel + slash menu ([Formatting](https://craft-support.mintlify.app/en/write-and-edit/formatting.md)) | Full table blocks |

**Synthesis — the "Word feel" consensus:** (a) hide all markers at rest; (b) reveal **exactly one
construct** — inline span or whole block — when the caret is *inside* it; (c) selection never forces
syntax into view (Bear: reveal only when the formatted run itself is selected); (d) exactly two editor
views (rendered-hybrid + raw source); (e) formatting affordances come from a small selection toolbar and
⌘B-style shortcuts, not from visible syntax; (f) line numbers are off/opt-in everywhere.

---

## 2. RQ2 — What users coming from Notion / Craft / Word expect

- **Notion:** blocks with hover handles (`+`, `⋮⋮`), slash menu, markdown *typing shortcuts that convert*
  ("- " + space → bullet; `**bold**` becomes bold **the moment you type it**), and a **selection popup
  toolbar** for bold/italic/etc. ([Intro to writing & editing](https://www.notion.com/help/writing-and-editing-basics),
  [Keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts) — Cmd/Ctrl+B etc.). Storage is a
  block JSON model, not markdown; markdown exists only as input affordance and export format.
- **Craft:** identical expectations, documented as "four ways to format": **selection → formatting
  toolbar** (bold/italic/highlight/link), slash menu, **markdown shortcuts that transform as you type**,
  keyboard shortcuts; plus an `Aa` Format panel ([Formatting](https://craft-support.mintlify.app/en/write-and-edit/formatting.md),
  [Markdown Shortcuts](https://craft-support.mintlify.app/en/write-and-edit/formatting/markdown-shortcuts.md);
  also supports `[[` page links and `==highlight==`). Craft exports to Markdown
  ([Export docs](https://craft-support.mintlify.app/en/import-and-export/export/document.md)).
- **Word:** the canonical expectation is: markers never exist; formatting is *applied to the selection*
  via ⌘/Ctrl+B/I/U or a ribbon; bullets are glyphs, headings are styles.

**UX implications for Worldloom (all satisfiable by decorations, §4):**
1. A compact selection toolbar (B / I / S / code / H1–H3 / quote / bullet / wikilink) that wraps/unwraps
   the *real* markdown bytes around the selection (already scoped in ADR-005).
2. ⌘B/⌘I/⌘K bindings doing the same.
3. Never show syntax for "selected lines" (current behavior) — that reads as a bug to Word/Notion users.
4. Wikilinks styled as chips (Bear/Obsidian-style), revealed only when caret enters the chip's span.
5. Checkbox/bullet glyphs, clickable (widget) — TTRPG GMs tick initiative/task boxes constantly.

---

## 3. RQ3 — Open-source building blocks that keep raw markdown as storage

Numbers below: GitHub/npm/Bundlephobia API pulls, **verified 2026-10-12**. "Bundle" = Bundlephobia
min+gzip of the core package(s).

### 3.0 Landscape summary

| Option | License | Core bundle (gz) | React fit | Maintenance (verified 2026-10-12) | Round-trip fidelity risk | Custom syntax (wikilinks) |
|---|---|---|---|---|---|---|
| **(a) Refined CM6 decorations** (current stack) | MIT (CM) | ≈ state 16 + view 78 + lang-markdown 171* KB | Already in app | CM6 6.43.x, @lezer/markdown 1.8.0 (2026-10-07), very active | **None by construction** (bytes untouched) | First-class (`@lezer/markdown` extension API) |
| **(b) Milkdown 7** (ProseMirror + remark) | MIT | core 93.4 + preset-commonmark 104.2; **Crepe UI 450.1** | `@milkdown/react` Provider+`useEditor` | Active: 11,984★, v7.22.3 published 2026-10-10, ~261k weekly DL ([Strapi comparison](https://strapi.io/blog/top-5-markdown-editors-for-react)) | **High** — remark-stringify rewrites; serializer corruption bug #2403 (2026); hybrid reveal incomplete/undocumented (#819 comments) | Via remark plugins + custom nodes; doable but serialize-side work |
| **(c) Tiptap 3 + `@tiptap/markdown`** (official; replaces community `tiptap-markdown`) | MIT | core 34.8 + starter-kit 103.5 + markdown 18.3 | First-class (React) | 38,693★, v3.31.4 (2026-09-30); markdown ext **explicitly beta** ([docs](https://tiptap.dev/docs/editor/markdown)) | **Very high** — see issue list below | Custom tokenizers exist (`createInlineMarkdownSpec`) but unproven for `[[…]]`; beta |
| **(c′) tiptap-markdown** (community, deprecated) | MIT | 61.3 | OK | 526★, last release 0.9.0 (2025-09-08); author: "I don't plan to address current issues / PR" ([README](https://github.com/aguingand/tiptap-markdown)) | High — 25 open mangling issues (tables #95/#81, task lists #94/#85, escaped bullets #65, tags stripped from cells #70, whitespace loss #57/#60) | No first-class support |
| **Toast UI Editor** | MIT | 157.9 (@toast-ui/editor 3.2.2, 2023-02-17) | Wrappers exist | **Repo archived** (nhn/tui.editor, last push 2024-08-01, 643 open issues) | Markdown is its own DOM→MD serializer; unmaintained | Poor | 
| **Vditor** (ir/wysiwyg/sv modes) | MIT | 68.6 (v4.0.0, 2026-08-30) | Generic DOM lib; React wrapper community-made | 11,371★, pushed 2026-10-02, active | Ir mode is "instant render" over Lute-side parsing; DOM-based serializer normalizes | Possible via Lute config, but stack is its own world |
| **ByteMD** | MIT | 128.8 (1.22.0, 2025-02-12) | React-first | 1,373★ (pd4d10/bytemd), last push 2025-02-12 — **dormant ~20 months** | Split-pane (CM5) + preview; not inline-reveal | N/A (source+preview only) |
| @uiw/react-md-editor | MIT | ~5.9 JS + 6 CSS ([Strapi](https://strapi.io/blog/top-5-markdown-editors-for-react)) | Native | Active (4.1.2, 2026-08-21) | Textarea split-pane; no inline reveal at all | N/A |

\* lang-markdown bundles the Lezer runtime + markdown parser; Worldloom already ships this stack.

### 3.1 (a) Refine our CM6 decoration approach — construct-scoped reveal

- **Precedent apps shipping exactly this model (raw bytes + reveal-on-caret):**
  - **Margin** (macOS notes app): "the document is always the Markdown source, and the rendered look is
    decorations painted over it, **revealed back to raw markup when the cursor enters a node**" — CM6 +
    `@lezer/markdown`, no HTML render step
    ([CommonMark forum, 2026-08-24](https://talk.commonmark.org/t/three-things-i-decided-not-to-parse-building-a-live-preview-editor/9126)).
    That thread also carries two hard-won extension lessons: parse `[[wikilinks]]` **before** the Link
    parser or `[[Name]]` gets eaten as a shortcut reference; and GFM splits table cells on `|` *before*
    inline parsing (escaped `\|` needed inside code spans).
  - **atomic-editor** (React, CM6, Obsidian-style): "the raw syntax appears only on the line your cursor
    is on… **Every decoration is view-only, so copy, save, and round-trip through any other markdown tool
    are byte-for-byte identical to a plain textarea**" — plus WYSIWYG tables via cell widgets and
    autocomplete'd wikilinks ([README](https://github.com/kenforthewin/atomic-editor)). Useful as a
    reference implementation to read, not necessarily to depend on.
  - **codemirror-markdown-hybrid** (npm, 2026): line-scoped hybrid preview as a packaged CM6 extension —
    evidence the extension shape is reusable ([repo](https://github.com/tiagosimoes/codemirror-markdown-hybrid),
    [forum thread](https://discuss.codemirror.net/t/9660)).
- **Cost:** we already own the parser (lezer), the hiding layer (replace decorations), and the tree-walk;
  the delta is the *reveal predicate* (§4) plus widget polish. **Risk: low**, no new dependency, ADR-002
  untouched.

### 3.2 (b) Milkdown — Typora-inspired, but a serializer on save

- Positioning: "plugin-driven WYSIWYG markdown Editor, inspired by Typora, built on top of prosemirror and
  remark" ([repo](https://github.com/Milkdown/milkdown), MIT, 11,984★, v7.22.3 published 2026-10-10 via npm).
- **Reveal ("hybrid") status:** the feature Worldloom needs was requested in
  [#645](https://github.com/Milkdown/milkdown/issues/645) ("Always display markdown syntax of block at
  cursor position, similar to Typora/Obsidian/Vditor"); the maintainer said it would land "in a progressive
  way", tracked in [#819 [RFC] Hybrid Editing](https://github.com/Milkdown/milkdown/issues/819) — checked
  off for **bold/italic/link/image only** (closed 2023-02). Users still asked *how to enable it* in
  2023-11 and 2024-02 with no answer in-thread: block-level reveal is not a documented, supported surface.
- **Fidelity:** on every edit Milkdown round-trips the document through remark's parser/stringifier pair,
  which normalizes markdown (bullet characters, emphasis style, escapes, whitespace). Real corruption:
  "[Bug] Nested strong/emphasis marks aren't remerged on serialize — **can silently corrupt formatting
  into literal**" ([#2403](https://github.com/Milkdown/milkdown/issues/2403), fixed 2026-07-02); table
  parse bug on paste ([#2259](https://github.com/Milkdown/milkdown/issues/2259)). Users' GM-vault markdown
  (frontmatter, wikilinks, callouts, indentation quirks) would be rewritten on save — direct ADR-002
  violation.
- Bundle and React: core+commonmark ≈198 KB gz; Crepe (prebuilt Typora-like UI) 450 KB gz; official React
  binding via Provider/`useEditor` ([Strapi](https://strapi.io/blog/top-5-markdown-editors-for-react)).
- **Verdict:** best-maintained framework option, but you still write the reveal layer yourself, accept
  normalization on save, and adopt ProseMirror as the document authority. Not compatible with ADR-002.

### 3.3 (c) Tiptap + markdown extensions — actively hostile to byte fidelity *right now*

- **Official `@tiptap/markdown` (v3.7.0+, current 3.31.4, 2026-09-30):** docs banner: "The markdown
  extension is a **early release** and can be subject to change or may have edge cases that may not be
  supported yet" ([Tiptap docs](https://tiptap.dev/docs/editor/markdown)). MarkedJS-lexer-based; custom
  tokenizers exist for non-standard syntax (`createBlockMarkdownSpec` / `createInlineMarkdownSpec`);
  documented limitations: comments unsupported, table cells limited to one child node.
- **Live fidelity evidence (opened 2026-10-09→11 against 3.31.x, all open at time of writing):**
  [#8471 serialize() over-escapes plain text: intraword `_` gets a backslash, `& < >` become entities](https://github.com/ueberdosis/tiptap/issues/8471) ·
  [#8468 link hrefs keep HTML entities → URL breaks after round trip](https://github.com/ueberdosis/tiptap/issues/8468) ·
  [#8460 fenced code block indented by 1–3 spaces is dropped on parse](https://github.com/ueberdosis/tiptap/issues/8460) ·
  [#8461 serializing a parsed empty ordered-list item throws](https://github.com/ueberdosis/tiptap/issues/8461) ·
  [#8472 ordered list nested in bullet parsed one level too high](https://github.com/ueberdosis/tiptap/issues/8472) ·
  [#8463 insertContent splits paragraph at caret (regression 3.22.4 → 3.31.4)](https://github.com/ueberdosis/tiptap/issues/8463).
  A GM's vault (frontmatter, `> [!callout]`, wikilinks, indented code, task lists) would hit several of these.
- **Community `tiptap-markdown` (aguingand, 526★):** now carries a deprecation banner pointing at the
  official extension — "I don't plan to address current issues / PR"
  ([README](https://github.com/aguingand/tiptap-markdown), last release 0.9.0, 2025-09-08). Its open
  issues are a catalog of mangling: tables unsupported/unrendered (#95/#27/#81), `#tags` removed from table
  cells on `getMarkdown()` (#70), escaped bullet items converted to real bullets (#65), whitespace/empty
  list items removed on setContent (#57), bold/italic adjacency loses a space (#60), multiline bold flaky
  (#74), long docs freeze `getMarkdown()` (#32).
- **Verdict:** ProseMirror JSON as document + serializer on save is architecturally disqualified by ADR-002,
  and the 2026 markdown layer is beta with active data-loss bugs. Hard no for M1.

### 3.4 (d) Toast UI / Vditor / ByteMD / others (2025–2026 status)

- **Toast UI Editor:** repository **archived** (last push 2024-08-01, 643 open issues), last npm release
  3.2.2 (2023-02-17), 158 KB gz. Dead — disqualifying.
- **Vditor:** active (11,371★; v4.0.0 published 2026-08-30; pushed 2026-10-02; MIT; 68.6 KB gz). Three
  modes — WYSIWYG, **Instant Rendering (ir)**, Split View ([README](https://github.com/Vanessa219/vditor)).
  `ir` is Typora-like markdown-source rendering, but the stack is Lute/Go-flavored semantics, DOM-centric,
  toolbar-first (36+ items), and React integration is third-party. Chinese-ecosystem gravity; wikilinks and
  Obsidian-style vault syntax would be custom work with the same serializer questions on the WYSIWYG side.
  Interesting as UX reference (its `ir` mode is the closest open Typora clone), not as a base.
- **ByteMD:** dormant since 2025-02-12 (v1.22.0; repo pd4d10/bytemd, 1,373★). Split-pane CM5 + preview —
  wrong interaction model anyway.
- **MDXEditor / BlockNote** (checked for completeness): Lexical/ProseMirror JSON storage — same
  serialization disqualification; MDXEditor 564 KB gz ([Strapi](https://strapi.io/blog/top-5-markdown-editors-for-react)).

---

## 4. RQ4 — CM6 techniques for construct-scoped reveal (how to actually do it)

### 4.1 The primitives (official CM6 reference)

- `Decoration.replace` hides/replaces ranges; `Decoration.widget` inserts DOM (bullets, checkboxes,
  wikilink chips); `Decoration.mark` styles; `Decoration.line` styles whole lines
  ([CM6 ref](https://codemirror.net/docs/ref/#view.Decoration.replace), [guide → Decorating the document](https://codemirror.net/docs/guide/#decorating-the-document)).
- Decorations come from a **state field** (needed when they depend on state outside the viewport —
  e.g. selection) or a **view plugin** (viewport-only, faster). Official guidance with full code:
  [Obsidian dev docs → Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations) — its worked
  example *is* the Worldloom case: `syntaxTree(state).iterate({ enter(node) … })`, replace the `-` of each
  list item (`node.from - 2`) with a widget; view-plugin version iterates only `view.visibleRanges` and
  rebuilds on `update.docChanged || update.viewportChanged`.

### 4.2 The reveal predicate (what to build)

Reveal is a **pure function of (syntax tree, selection)** — which is why ADR-005's "unit-testable
headless" note holds. Target semantics (matches §1 synthesis):

```
focusedInlineSpans  = inline nodes N (StrongEmphasis/Emphasis/InlineCode/Link/Wikilink/…)
                      where ∃ selection range r with r.empty ∧ N.from ≤ r.from ≤ N.to
                      (caret strictly inside; an anchor+cursor selection that merely *crosses* N does NOT reveal)
focusedBlocks      = block nodes (ATXHeading, Blockquote, ListItem, Frontmatter, Table)
                      where ∃ selection range r with [r.from, r.to] intersects the node's line span
visibleMarkers(M)  = M is hidden  ⇔  M ∩ (∪ focusedInlineSpans ∪ ∪ focusedBlocks) = ∅
```

Implementation notes, each tied to a known pitfall:

1. **Two decoration passes:** baseline hide-set (all markers, viewport-limited) minus focus-reveals. Easiest
   correct form: one `RangeSetBuilder` sweep over `syntaxTree(view.state).iterate({from, to})` inside
   `view.visibleRanges`, skipping any marker range that intersects a focused span/block. Keep the builder's
   output **sorted** (CM6 requirement) — walk selection ranges in document order as you iterate nodes.
2. **Rebuild triggers:** `docChanged || viewportChanged || selectionSet` — reveal must repaint on caret
   moves alone (view plugin `update()` receives `selectionSet`; the Obsidian recipe above only shows
   doc/viewport because its example is selection-independent). For large docs, consider a two-tier
   DecorationSet: doc-range decorations mapped through `set.map(changes)` on edits, focus decorations
   rebuilt on every selection change (cheap: they're viewport-local).
3. **Block vs inline granularity:** headings/quotes/frontmatter/list bullets reveal as a *unit* when the
   caret is anywhere in the block (Typora/Obsidian); `**bold**`/`` `code` ``/`[[wikilink]]` reveal only the
   exact span. Don't fall back to "reveal whole line" for inline marks — that's the current Worldloom
   behavior the CTO flagged, and no reference editor does it for inline constructs.
4. **Widgets and the caret:** list bullets/checkboxes/chips are `Decoration.replace({ widget })` over the
   marker bytes. Two cursor rules matter: (a) if the chip should *reveal on click*, don't add it to
   `atomicRanges` (which would make the caret skip it) — instead handle `mousedown` to position the caret
   inside the hidden `[[…]]` range; (b) never let a replaced range *contain* the selection without
   revealing it — this is the classic cursor-jump bug (a hidden marker the caret teleports across). Guard:
   `!selectionTouches(markerRange)` before emitting the replace decoration.
5. **Lezer extensions:** wikilinks/callouts need custom inline/block parsers via `@lezer/markdown`'s
   extension API (`MarkdownExtension`, `parseCode`); register the wikilink parser with `before: "Link"`
   or `[[Name|Alias]]` gets parsed as a shortcut reference link (hard-won note from a shipping CM6
   markdown app: [talk.commonmark.org #9126](https://talk.commonmark.org/t/three-things-i-decided-not-to-parse-building-a-live-preview-editor/9126)).
6. **Selection toolbar interop (ADR-005):** toolbar commands wrap the selection in real bytes
   (`**`+sel+`**`) via `dispatch({ changes: … })`; after wrapping, place the caret to skip the inserted
   markers so the just-typed construct doesn't immediately reveal (or reveal it — Typora shows it while
   typing; pick one and test).
7. **Multi-cursor:** compute focus sets from *all* `state.selection.ranges`, not just `main`.
8. **Testing:** the predicate + tree-walk are pure over `EditorState.create({ doc, selection })` +
   `@codemirror/lang-markdown` — golden-file tests per construct (nested bold-in-heading, wikilink with
   alias inside a list item, frontmatter block, task list, pipe table) without mounting a view.

### 4.3 What *not* to copy

- Zettlr's per-element-type toggles (power-user model, no caret scoping) and iA Writer's always-visible
  source are different products; keep them as inspiration for the opt-in *source* view only.
- Obsidian additionally exposes mode detection to plugins (`editorLivePreviewField`,
  [API](https://docs.obsidian.md/Reference/TypeScript+API/editorLivePreviewField)) — useful pattern if
  Worldloom plugins need it later; not needed for M1.

---

## 5. Recommendation

**Refine our CM6 decoration engine to construct-scoped, caret-gated reveal. Adopt no editor framework.**

Reasoning:

1. **Losslessness is non-negotiable (ADR-002) and only the decoration model guarantees it.** Every
   framework option owns the document as JSON/AST and re-serializes: Tiptap's official markdown layer is
   *beta* with live round-trip bug reports about escaping, entities, fences, and list nesting (§3.3);
   the deprecated community package has 25 open mangling issues incl. tables and wikilink-adjacent
   constructs; Milkdown had a serializer bug that could "silently corrupt formatting into literal" text
   (§3.2) and its remark-stringify layer normalizes user bytes on every save. A GM's vault — frontmatter,
   `> [!note]` callouts, `[[wikilinks|aliases]]`, task lists, indented code, hand-tuned lists — would get
   rewritten. That is the exact failure mode ADR-002 exists to prevent.
2. **Reveal behavior is *the* product differentiator here, and frameworks don't give it to us.** Milkdown's
   hybrid reveal is inline-mark-only and effectively undocumented (#819); Tiptap has no equivalent; only
   CM6-decoration apps (Obsidian, Margin, atomic-editor) implement caret-scoped reveal — by writing the
   predicate themselves (§4.2). We'd write that code anyway, on top of a framework, plus fight its
   serializer. We already have the parser, the hide layer, and a shipped live preview; the delta is the
   focus predicate + widget polish.
3. **Cost:** ~2–4 focused weeks — see §6. No new runtime dependency; CM6/lezer are actively maintained
   (CM6 6.43.x, `@lezer/markdown` 1.8.0 published 2026-10-07).

**Decision-aligned behaviors to ship (spec):**
- Two views only: **live** (default) and **source** (raw). 'Read' split stays opt-in.
- Reveal rule: caret inside an inline construct → that construct's markers only; caret/selection inside a
  block construct → that block's markers; **selection never reveals syntax** (Bear-style "reveal the
  selected run" is the only sanctioned variant if a user study demands it — it is a flag-sized change in
  the same predicate).
- Selection toolbar + ⌘B/⌘I/⌘K wrapping raw bytes (ADR-005).
- Widgets: bullet/checkbox glyphs (clickable checkboxes), wikilink chips (click-to-open; caret inside chip
  reveals `[[…]]`).

**Fallback (only if the reveal engine exceeds ~6 weeks or stalls on CM6 corner cases):** evaluate **Milkdown
7 + Crepe** as a *presentation* layer with a write-behind strategy that saves only minimal diffs — but treat
this as an ADR-002 amendment with byte-fidelity tests (round-trip a corpus of GM-style vault files
byte-for-byte) before adoption; the evidence in §3.2 suggests that gate would fail today.

---

## 6. Effort estimate (refined-CM6 path)

| Work item | Estimate |
|---|---|
| Reveal predicate (inline+block) as pure function + golden tests | 2–3 days |
| Integrate predicate into existing decoration builder; selectionSet rebuilds; multi-cursor | 2–3 days |
| Block widgets: bullet/checkbox glyphs, clickable checkboxes, indent guides | 2–3 days |
| Wikilink chip widget: reveal-on-caret-inside, click-to-open, `[[a\|b]]` alias | 2–3 days |
| Selection toolbar (B/I/code/H1-3/quote/bullet/wikilink) + ⌘B/⌘I/⌘K wrapping | 2–3 days |
| Tables pass (rendered grid at rest, pipe-source when caret inside) | 3–5 days |
| Edge-case hardening: nested marks, frontmatter, callouts, IME, large-doc perf | 3–5 days |
| **Total** | **~3–4 weeks** (≈2 weeks focused) |

## 7. Risks

1. **Cursor jumps when markers appear/disappear under the caret** (CM6 replace-decoration ↔ selection
   mapping). Mitigation: the §4.2.4 guard + dedicated tests for caret-at-boundary cases; CM6 maps positions
   through decoration changes, but widgets changing line width cause *visual* jumps — prefer
   `Decoration.replace` with side-preserving widgets and stable line metrics.
2. **Obsidian's exact predicate is not officially documented** — we're triangulating from its docs,
   Milkdown's issue framing, and community reimplementations. Mitigation: 30-minute hands-on verification
   pass against Obsidian before locking the spec (open task).
3. **Lezer extension pitfalls** (wikilink vs Link precedence; table cell pipes inside code spans) —
   mitigated by citing shipping-app experience (§3.1, §4.2.5) and golden tests over GM-vault fixtures.
4. **Performance** on 10k+ line session docs: viewport-limited iteration + mapped DecorationSets; atomic-editor
   demonstrates smooth 500-page virtualized docs on the same approach.
5. **Scope creep toward "just render HTML"** — rejected: no HTML render step keeps paste/export/search
   honest (ADR-002); render *is* decorations.

---

## Sources (all accessed 2026-10-12)

**Obsidian** — [Views and editing mode](https://obsidian.md/help/edit-and-read) ·
[Settings](https://obsidian.md/help/settings) ·
[Dev docs: Decorations](https://docs.obsidian.md/Plugins/Editor/Decorations) ·
[editorLivePreviewField](https://docs.obsidian.md/Reference/TypeScript+API/editorLivePreviewField)
**Typora** — [Quick Start](https://support.typora.io/Quick-Start/) ·
[What's New 1.13 (2026-04-03)](https://support.typora.io/What's-New-1.13/) ·
[Typesetting with CSS](https://support.typora.io/Typeset/) ·
[Focus & Typewriter Mode](https://support.typora.io/Focus-and-Typewriter-Mode/)
**iA Writer** — [Wikilinks](https://ia.net/writer/support/library/wikilinks) ·
[Settings](https://ia.net/writer/support/basics/settings) ·
[Syntax Highlight](https://ia.net/writer/support/editor/syntax-highlight)
**Zettlr** — [Docs: Appearance](https://docs.zettlr.com/en/editor/appearance.html) ·
[Repo](https://github.com/Zettlr/Zettlr) (GPL-3.0, 13,751★, v4.8.0 CM6 deps)
**Bear** — [Bear 2 is here! (2023-07-11)](https://blog.bear.app/2023/07/bear-2-is-here/) ·
[FAQ: How to use Markdown in Bear](https://bear.app/faq/how-to-use-markdown-in-bear/)
**Notion** — [Intro to writing & editing](https://www.notion.com/help/writing-and-editing-basics) ·
[Keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts)
**Craft** — [Formatting](https://craft-support.mintlify.app/en/write-and-edit/formatting.md) ·
[Markdown Shortcuts](https://craft-support.mintlify.app/en/write-and-edit/formatting/markdown-shortcuts.md) ·
[Export](https://craft-support.mintlify.app/en/import-and-export/export/document.md)
**CodeMirror / Lezer** — [CM6 ref: Decoration.replace](https://codemirror.net/docs/ref/#view.Decoration.replace) ·
[CM6 guide: Decorating the document](https://codemirror.net/docs/guide/#decorating-the-document) ·
[discuss.codemirror.net #9660](https://discuss.codemirror.net/t/9660) ·
[CommonMark talk #9126 (Margin, 2026-08-24)](https://talk.commonmark.org/t/three-things-i-decided-not-to-parse-building-a-live-preview-editor/9126) ·
npm/Bundlephobia: @codemirror/view 6.43.14, @lezer/markdown 1.8.0 (2026-10-07)
**Milkdown** — [Repo](https://github.com/Milkdown/milkdown) (MIT, 11,984★, v7.22.3 2026-10-10) ·
[#645 block syntax at cursor](https://github.com/Milkdown/milkdown/issues/645) ·
[#819 RFC Hybrid Editing](https://github.com/Milkdown/milkdown/issues/819) ·
[#2403 serialize corruption](https://github.com/Milkdown/milkdown/issues/2403) ·
[Strapi React editors comparison (2025-12, updated w/ Aug–Sep 2026 data)](https://strapi.io/blog/top-5-markdown-editors-for-react)
**Tiptap** — [Official markdown docs (beta)](https://tiptap.dev/docs/editor/markdown) ·
[tiptap-markdown deprecation notice](https://github.com/aguingand/tiptap-markdown) ·
issues [#8471](https://github.com/ueberdosis/tiptap/issues/8471) [#8468](https://github.com/ueberdosis/tiptap/issues/8468) [#8460](https://github.com/ueberdosis/tiptap/issues/8460) [#8461](https://github.com/ueberdosis/tiptap/issues/8461) [#8472](https://github.com/ueberdosis/tiptap/issues/8472) [#8463](https://github.com/ueberdosis/tiptap/issues/8463) ·
tiptap-markdown issues [#95](https://github.com/aguingand/tiptap-markdown/issues/95) [#70](https://github.com/aguingand/tiptap-markdown/issues/70) [#65](https://github.com/aguingand/tiptap-markdown/issues/65) [#57](https://github.com/aguingand/tiptap-markdown/issues/57) [#32](https://github.com/aguingand/tiptap-markdown/issues/32)
**Others** — [Toast UI repo (archived)](https://github.com/nhn/tui.editor) ·
[Vditor README](https://github.com/Vanessa219/vditor) (11,371★, v4.0.0 2026-08-30) ·
[ByteMD](https://github.com/pd4d10/bytemd) (dormant 2025-02-12) ·
[atomic-editor](https://github.com/kenforthewin/atomic-editor) ·
[codemirror-markdown-hybrid](https://github.com/tiagosimoes/codemirror-markdown-hybrid) ·
[antigravity-live-preview](https://github.com/Rauglothgor/antigravity-live-preview)
