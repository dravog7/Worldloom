/**
 * Live-preview decorations (ADR-005): markdown stays the storage bytes;
 * syntax is hidden with replace decorations and styled with marks. A
 * construct keeps its raw syntax visible only when `isConstructRevealed`
 * says so (see `reveal.ts`): the caret is inside that construct — inclusive
 * of both edges — or a selection partially cuts it. Nothing else reveals:
 * no whole lines, no merely-selected regions (docs/DISCOVERY-editor-models
 * §3–§4). Block-level constructs (heading, quote, list item, rule, fenced
 * block) reveal as a unit over their syntax-node span; inline constructs
 * (strong/em/code/wikilink) over their exact span.
 *
 * Pure function over (doc, lezer syntax tree, selection ranges) — no view,
 * no DOM at computation time — so the whole preview surface is unit-testable
 * in plain Node (widgets only touch the DOM in `toDOM`, when rendered).
 *
 * Robustness rule: whenever the parser does not cleanly delimit a construct
 * (unexpected marker text, odd nesting, degenerate wikilink), we emit NO
 * decoration for it. A missing style is cosmetic; a wrong replace range
 * would corrupt the document.
 */

import type { SelectionRange, Text } from "@codemirror/state";
import { Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isConstructRevealed } from "./reveal";

/** Revealed heading hashes: raw text shown, dimmed. */
class RawSyntaxWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly className: string,
  ) {
    super();
  }

  eq(other: RawSyntaxWidget): boolean {
    return other.label === this.label && other.className === this.className;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.label;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Collapsed bullet marker → dim `•` glyph. */
function bulletWidget(): RawSyntaxWidget {
  return new RawSyntaxWidget("•", "wl-md-bullet");
}

/** Revealed hash run → dim raw `#…` text. */
function hashWidget(raw: string): RawSyntaxWidget {
  return new RawSyntaxWidget(raw, "wl-md-hash");
}

/** Collapsed horizontal rule → styled `<hr>` element. */
class RuleWidget extends WidgetType {
  readonly label = "—";

  eq(other: RuleWidget): boolean {
    return other instanceof RuleWidget;
  }

  toDOM(): HTMLElement {
    const rule = document.createElement("hr");
    rule.className = "wl-md-hr";
    return rule;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const HEADING_CLASSES = ["", "wl-md-h1", "wl-md-h2", "wl-md-h3"] as const;
const HASH_RUN = /^#+$/u;
const FENCE_RUN = /^`{3,}$/u;
const BULLET_MARK = /^[-*]$/u;
const RULE_LINE = /^[-*_]{3,}$/u;

/**
 * Computes the full decoration set for one document state.
 *
 * @param doc         The markdown document (storage bytes).
 * @param syntaxNode  Root of the @lezer/markdown parse (`tree.topNode`).
 * @param selections  All selection ranges; reveal is scoped per construct
 *                    against these (multi-cursor aware).
 * @returns A sorted DecorationSet; replace ranges never overlap.
 */
export function computeDecorations(
  doc: Text,
  syntaxNode: SyntaxNode,
  selections: readonly SelectionRange[],
): DecorationSet {
  const tree = syntaxNode.tree;
  if (!tree) return Decoration.none;

  const specs: ReturnType<Decoration["range"]>[] = [];
  const lined = new Set<string>();
  let lastReplaceTo = 0;

  /** A construct reveals its raw syntax iff the caret/selection rule says so. */
  const revealed = (node: { from: number; to: number }): boolean =>
    isConstructRevealed(node.from, node.to, selections);

  const pushLine = (from: number, cls: string): void => {
    const key = `${from}|${cls}`;
    if (lined.has(key)) return;
    lined.add(key);
    specs.push(Decoration.line({ class: cls }).range(from, from));
  };

  const pushMark = (from: number, to: number, cls: string): void => {
    if (to <= from) return;
    specs.push(Decoration.mark({ class: cls }).range(from, to));
  };

  /**
   * Replace decorations must never overlap (CM6 requirement). Constructs are
   * visited in ascending document order, so a monotonic guard is enough:
   * anything that would collide is dropped (robustness rule).
   */
  const pushReplace = (from: number, to: number, widget?: WidgetType): void => {
    if (to <= from || from < lastReplaceTo) return;
    lastReplaceTo = to;
    specs.push(Decoration.replace(widget ? { widget } : {}).range(from, to));
  };

  const lineClassFor = (line: number, cls: string): void => {
    pushLine(doc.line(line).from, cls);
  };

  const heading = (node: SyntaxNode, level: 1 | 2 | 3): void => {
    lineClassFor(doc.lineAt(node.from).number, HEADING_CLASSES[level]);
    // The heading node (hashes + text) is the reveal unit: typing anywhere
    // in it — including at the line's end — keeps the hashes visible.
    const show = revealed(node);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name !== "HeaderMark") continue;
      const raw = doc.sliceString(child.from, child.to);
      if (!HASH_RUN.test(raw)) continue; // parser oddity → leave raw
      if (show) pushReplace(child.from, child.to, hashWidget(raw));
      else pushReplace(child.from, child.to);
    }
  };

  const emphasisMarkers = (node: SyntaxNode): [SyntaxNode, SyntaxNode] | null => {
    const first = node.firstChild;
    const last = node.lastChild;
    if (!first || !last || first === last) return null;
    // @lezer/markdown names both `*`/`**` delimiter runs EmphasisMark.
    if (first.name !== "EmphasisMark" || last.name !== "EmphasisMark") return null;
    return [first, last];
  };

  const inline = (
    node: SyntaxNode,
    marker: string,
    cls: string,
  ): void => {
    const marks = emphasisMarkers(node);
    if (!marks) return;
    const [open, close] = marks;
    // Only the exact `*…*` / `**…**` forms; `__…__` etc. stay raw.
    if (
      doc.sliceString(open.from, open.to) !== marker ||
      doc.sliceString(close.from, close.to) !== marker
    )
      return;
    if (!revealed(node)) {
      pushReplace(open.from, open.to);
      pushReplace(close.from, close.to);
    }
    pushMark(node.from + marker.length, node.to - marker.length, cls);
  };

  const inlineCode = (node: SyntaxNode): void => {
    const first = node.firstChild;
    const last = node.lastChild;
    if (!first || !last || first === last) return;
    if (first.name !== "CodeMark" || last.name !== "CodeMark") return;
    // Single-backtick delimiters only; multi-backtick spans stay raw.
    if (first.to - node.from !== 1 || node.to - last.from !== 1) return;
    if (!revealed(node)) {
      pushReplace(first.from, first.to);
      pushReplace(last.from, last.to);
    }
    pushMark(node.from + 1, node.to - 1, "wl-md-code");
  };

  const blockquote = (node: SyntaxNode): void => {
    const first = doc.lineAt(node.from).number;
    const last = doc.lineAt(node.to).number;
    for (let n = first; n <= last; n++) lineClassFor(n, "wl-md-quote");
  };

  /**
   * The `>` marker is handled wherever it appears in the tree: markdown's
   * lazy continuation nests a follow-up line's QuoteMark inside the
   * paragraph, not as a direct Blockquote child. The reveal unit is the
   * whole quote block (markers show while the caret is anywhere in it,
   * Typora/Obsidian-style), so walk up to the enclosing Blockquote.
   */
  const quoteMark = (node: SyntaxNode): void => {
    if (doc.sliceString(node.from, node.to).trim() !== ">") return;
    let scope: SyntaxNode | null = node.parent;
    while (scope && scope.name !== "Blockquote") scope = scope.parent;
    if (!revealed(scope ?? node)) pushReplace(node.from, node.to);
  };

  const listItem = (node: SyntaxNode): void => {
    const mark = node.firstChild;
    if (!mark || mark.name !== "ListMark") return;
    // Ordered-list marks (`1.`) are not bullets — leave them raw.
    if (!BULLET_MARK.test(doc.sliceString(mark.from, mark.to))) return;
    // The item (marker + content) is the reveal unit, like a heading.
    if (!revealed(node)) pushReplace(mark.from, mark.to, bulletWidget());
  };

  const horizontalRule = (node: SyntaxNode): void => {
    if (revealed(node)) return;
    const line = doc.lineAt(node.from);
    // Only collapse rules that own their whole line (never mid-text).
    if (node.from !== line.from || node.to !== line.to) return;
    if (!RULE_LINE.test(line.text)) return;
    pushReplace(node.from, node.to, new RuleWidget());
  };

  const fencedCode = (node: SyntaxNode): void => {
    const first = doc.lineAt(node.from).number;
    const last = doc.lineAt(node.to).number;
    for (let n = first; n <= last; n++) lineClassFor(n, "wl-md-fenced");
    // The whole block is the reveal unit: a caret anywhere inside (including
    // the code content) shows both fence delimiters.
    const show = revealed(node);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name !== "CodeMark") continue;
      if (!FENCE_RUN.test(doc.sliceString(child.from, child.to))) continue;
      if (!show) pushReplace(child.from, child.to);
    }
  };

  /**
   * Wikilinks: the commonmark parser half-delimits `[[target]]` as an inner
   * `Link` node; we require the literal `[[` before and `]]` after (same
   * line, non-degenerate target) before styling anything. The chip hides the
   * brackets (and the `target|` part when a display alias exists); revealed
   * lines keep everything raw.
   */
  const wikilink = (node: SyntaxNode): void => {
    if (node.from < 1 || node.to + 1 > doc.length) return;
    // The Link node spans the INNER brackets; exactly one outer bracket
    // must sit on each side for this to be a `[[wikilink]]`.
    if (doc.sliceString(node.from - 1, node.from) !== "[") return;
    if (doc.sliceString(node.to, node.to + 1) !== "]") return;
    const inner = doc.sliceString(node.from + 1, node.to - 1);
    if (inner === "" || inner.includes("[") || inner.includes("]")) return;
    const pipe = inner.indexOf("|");
    const target = pipe === -1 ? inner : inner.slice(0, pipe);
    if (target === "") return; // [[|display]] — degenerate, leave raw

    const spanFrom = node.from - 1;
    const spanTo = node.to + 1;
    pushMark(spanFrom, spanTo, "wl-md-wikilink");
    if (revealed(node)) return;
    pushReplace(spanFrom, spanFrom + 2); // [[
    if (pipe !== -1) pushReplace(node.from + 1, node.from + 2 + pipe); // target|
    pushReplace(spanTo - 2, spanTo); // ]]
  };

  const walk = (node: SyntaxNode): void => {
    switch (node.name) {
      case "ATXHeading1":
        heading(node, 1);
        break;
      case "ATXHeading2":
        heading(node, 2);
        break;
      case "ATXHeading3":
        heading(node, 3);
        break;
      case "SetextHeading1":
        // Setext underlines stay raw (phase 1); the text line still styles.
        lineClassFor(doc.lineAt(node.from).number, "wl-md-h1");
        break;
      case "SetextHeading2":
        lineClassFor(doc.lineAt(node.from).number, "wl-md-h2");
        break;
      case "StrongEmphasis":
        inline(node, "**", "wl-md-strong");
        break;
      case "Emphasis":
        inline(node, "*", "wl-md-em");
        break;
      case "InlineCode":
        inlineCode(node);
        break;
      case "Blockquote":
        blockquote(node);
        break;
      case "QuoteMark":
        quoteMark(node);
        break;
      case "ListItem":
        listItem(node);
        break;
      case "HorizontalRule":
        horizontalRule(node);
        break;
      case "FencedCode":
        fencedCode(node);
        break;
      case "Link":
        wikilink(node);
        break;
      default:
        break;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
  };

  walk(syntaxNode);
  return Decoration.set(specs, true);
}
