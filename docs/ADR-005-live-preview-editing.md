# ADR-005 — Live preview editing: markdown is storage, not interface

**Date:** 2026-10-12 · **Status:** approved (CTO direction: "don't expose Markdown first;
editable in preview; users needn't know markdown")

## Decision

The primary editing surface is **live preview**: a CodeMirror 6 document whose contents
are still raw markdown bytes, with syntax hidden and rendered via decorations (headings
styled, `**bold**`/`*italic*`/`` `code` `` markers hidden, `[[wikilinks]]` shown as gold
chips, blockquote/list markers collapsed to styled glyphs). Raw syntax is revealed only
on the construct under the cursor. Layout default becomes single-pane live editor;
'read' split (editor+preview) and 'source' (raw markdown) remain opt-in modes.

A compact formatting toolbar (B / I / H1 / H2 / quote / bullet / wikilink) wraps the
selection in the underlying markdown syntax, so users who don't know markdown can still
write it.

## Why this over a WYSIWYG document model (TipTap/ProseMirror)

Round-trip fidelity: a rich-text model cannot losslessly represent arbitrary markdown;
saving through one would silently rewrite users' files (tables, unusual constructs,
Obsidian-vault formatting). That breaks ADR-002's trust promise. CM6 decorations edit
the real bytes: **what you type is what gets saved**, always diffable, Obsidian-compatible.
Obsidian's Live Preview proves this model is exactly what this audience expects.

## Consequences

- Decoration logic is a pure function over (doc, syntax tree) → unit-testable headless.
- Source mode remains for power users and debugging.
- M1.2 candidates: click-to-open wikilinks in editor, table rendering pass, cursor-position
  floating toolbar.
