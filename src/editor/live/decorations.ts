/**
 * Live-preview decorations (ADR-005, reworked by W1): markdown stays the
 * storage bytes; syntax hiding is TOTAL and UNCONDITIONAL — every marker
 * (heading hashes, emphasis, strikethrough, inline code, links, wikilinks,
 * quote markers, list markers, rules, fence lines, HTML comments, `<u>`
 * tags, YAML frontmatter) is hidden at all times, wherever the caret or
 * selection is. The M1.2 construct-scoped reveal rule (reveal.ts) was
 * intentionally deleted in this wave: the caret may sit anywhere and
 * nothing reveals (docs/DISCOVERY-editor-models §3–§4 superseded by the W1
 * CTO decision). The `selectionRanges` argument stays in the frozen
 * signature for compatibility but no longer influences the output.
 *
 * Frontmatter exception: the leading YAML block (`---` … closing `---`)
 * is *replaced*, not merely hidden, by one subtle 'Note properties' chip
 * widget that dispatches the frozen `wl-open-properties` CustomEvent.
 *
 * Pure function over (doc, lezer syntax tree) — no view, no DOM at
 * computation time — so the whole preview surface is unit-testable in
 * plain Node (widgets only touch the DOM in `toDOM`, when rendered).
 *
 * Robustness rule: whenever the parser does not cleanly delimit a construct
 * (unexpected marker text, odd nesting, degenerate wikilink), we emit NO
 * decoration for it. A missing style is cosmetic; a wrong replace range
 * would corrupt the document.
 */

import type { SelectionRange, Text } from "@codemirror/state";
import { Decoration, DecorationSet, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import "./frontmatter-chip.css";

/** Dim raw-syntax span widget (ordered list markers). */
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

/**
 * Collapsed ordered marker (`1.` / `11)`) → dim raw glyph: the number is
 * semantic content, the dot/paren syntax is what gets replaced.
 */
function orderedWidget(raw: string): RawSyntaxWidget {
  return new RawSyntaxWidget(raw, "wl-md-bullet");
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

/**
 * Replaces the whole YAML frontmatter block with one subtle chip (W1). The
 * chip lives inside view.dom, so its bubbling CustomEvent reaches any
 * host-level listener (frozen contract: `wl-open-properties`).
 */
class FrontmatterChipWidget extends WidgetType {
  readonly label = "Note properties";

  eq(other: FrontmatterChipWidget): boolean {
    return other instanceof FrontmatterChipWidget;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "wl-frontmatter-chip";
    chip.textContent = this.label;
    chip.setAttribute("aria-label", this.label);
    chip.setAttribute("contenteditable", "false");
    chip.addEventListener("click", () => {
      chip.dispatchEvent(
        new CustomEvent("wl-open-properties", { bubbles: true }),
      );
    });
    return chip;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

/** h4–h6 reuse the h3 class (existing live.css styling, no new rules). */
const HEADING_CLASSES = ["", "wl-md-h1", "wl-md-h2", "wl-md-h3"] as const;
const HASH_RUN = /^#+$/u;
const FENCE_RUN = /^`{3,}$/u;
const BULLET_MARK = /^[-*+]$/u;
const ORDERED_MARK = /^\d+[.)]$/u;
const RULE_LINE = /^[-*_]{3,}$/u;
const UNDERLINE_OPEN = "<u>";
const UNDERLINE_CLOSE = "</u>";

/**
 * Leading YAML frontmatter: the doc opens with a `---` line and some later
 * line is exactly `---`. Returns the end position of the closing delimiter
 * line, or null when the doc has no frontmatter.
 */
function frontmatterEnd(doc: Text): number | null {
  if (doc.lines < 2) return null;
  if (doc.line(1).text !== "---") return null;
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text === "---") return line.to;
  }
  return null;
}

/**
 * Computes the full decoration set for one document state.
 *
 * @param doc          The markdown document (storage bytes).
 * @param syntaxNode   Root of the @lezer/markdown parse (`tree.topNode`).
 * @param _selections  Unused since W1 (frozen signature): hiding is
 *                     unconditional — no selection ever reveals syntax.
 * @returns A sorted DecorationSet; replace ranges never overlap.
 */
export function computeDecorations(
  doc: Text,
  syntaxNode: SyntaxNode,
  _selections: readonly SelectionRange[],
): DecorationSet {
  const tree = syntaxNode.tree;
  if (!tree) return Decoration.none;

  const specs: ReturnType<Decoration["range"]>[] = [];
  const lined = new Set<string>();
  let lastReplaceTo = 0;

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

  // W1: the whole frontmatter block becomes one chip — pushed first so the
  // monotonic guard also drops any stray construct decoration inside it.
  const fmEnd = frontmatterEnd(doc);
  if (fmEnd !== null) pushReplace(0, fmEnd, new FrontmatterChipWidget());

  const heading = (node: SyntaxNode, level: 1 | 2 | 3 | 4 | 5 | 6): void => {
    lineClassFor(
      doc.lineAt(node.from).number,
      HEADING_CLASSES[Math.min(level, 3)],
    );
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name !== "HeaderMark") continue;
      if (!HASH_RUN.test(doc.sliceString(child.from, child.to))) continue;
      pushReplace(child.from, child.to);
    }
  };

  const emphasisMarkers = (node: SyntaxNode): [SyntaxNode, SyntaxNode] | null => {
    const first = node.firstChild;
    const last = node.lastChild;
    if (!first || !last || first === last) return null;
    // @lezer/markdown names both `*`/`_` delimiter runs EmphasisMark.
    if (first.name !== "EmphasisMark" || last.name !== "EmphasisMark") return null;
    return [first, last];
  };

  const inline = (
    node: SyntaxNode,
    markers: readonly string[],
    cls: string,
  ): void => {
    const marks = emphasisMarkers(node);
    if (!marks) return;
    const [open, close] = marks;
    const marker = doc.sliceString(open.from, open.to);
    if (!markers.includes(marker)) return; // `__…__` etc. stay raw
    if (doc.sliceString(close.from, close.to) !== marker) return;
    pushReplace(open.from, open.to);
    pushReplace(close.from, close.to);
    pushMark(node.from + marker.length, node.to - marker.length, cls);
  };

  const strikethrough = (node: SyntaxNode): void => {
    const first = node.firstChild;
    const last = node.lastChild;
    if (!first || !last || first === last) return;
    if (first.name !== "StrikethroughMark" || last.name !== "StrikethroughMark")
      return;
    if (
      doc.sliceString(first.from, first.to) !== "~~" ||
      doc.sliceString(last.from, last.to) !== "~~"
    )
      return;
    pushReplace(first.from, first.to);
    pushReplace(last.from, last.to);
    pushMark(node.from + 2, node.to - 2, "wl-md-strike");
  };

  const inlineCode = (node: SyntaxNode): void => {
    const first = node.firstChild;
    const last = node.lastChild;
    if (!first || !last || first === last) return;
    if (first.name !== "CodeMark" || last.name !== "CodeMark") return;
    // Single-backtick delimiters only; multi-backtick spans stay raw.
    if (first.to - node.from !== 1 || node.to - last.from !== 1) return;
    pushReplace(first.from, first.to);
    pushReplace(last.from, last.to);
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
   * paragraph, not as a direct Blockquote child.
   */
  const quoteMark = (node: SyntaxNode): void => {
    if (doc.sliceString(node.from, node.to).trim() !== ">") return;
    pushReplace(node.from, node.to);
  };

  const listItem = (node: SyntaxNode): void => {
    const mark = node.firstChild;
    if (!mark || mark.name !== "ListMark") return;
    const raw = doc.sliceString(mark.from, mark.to);
    if (BULLET_MARK.test(raw)) pushReplace(mark.from, mark.to, bulletWidget());
    else if (ORDERED_MARK.test(raw))
      pushReplace(mark.from, mark.to, orderedWidget(raw));
  };

  const horizontalRule = (node: SyntaxNode): void => {
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
    // The whole opening fence line (info string included) disappears.
    const openLine = doc.lineAt(node.from);
    pushReplace(node.from, openLine.to);
    // Same for the closing fence line — only when the block really closes
    // (an unclosed fence's last child is CodeInfo/CodeText, never CodeMark).
    const close = node.lastChild;
    if (
      close &&
      close.name === "CodeMark" &&
      close.to === node.to &&
      FENCE_RUN.test(doc.sliceString(close.from, close.to))
    ) {
      const closeLine = doc.lineAt(close.from);
      pushReplace(closeLine.from, closeLine.to);
    }
  };

  /**
   * Wikilinks: the commonmark parser half-delimits `[[target]]` as an inner
   * `Link` node; we require the literal `[[` before and `]]` after (same
   * line, non-degenerate target) before styling anything. The chip hides the
   * brackets (and the `target|` part when a display alias exists). Shape
   * detection is separate from emission so the Link case can branch first.
   */
  const wikilinkShape = (
    node: SyntaxNode,
  ): { spanFrom: number; spanTo: number; pipe: number } | null => {
    if (node.from < 1 || node.to + 1 > doc.length) return null;
    // The Link node spans the INNER brackets; exactly one outer bracket
    // must sit on each side for this to be a `[[wikilink]]`.
    if (doc.sliceString(node.from - 1, node.from) !== "[") return null;
    if (doc.sliceString(node.to, node.to + 1) !== "]") return null;
    const inner = doc.sliceString(node.from + 1, node.to - 1);
    if (inner === "" || inner.includes("[") || inner.includes("]")) return null;
    const pipe = inner.indexOf("|");
    const target = pipe === -1 ? inner : inner.slice(0, pipe);
    if (target === "") return null; // [[|display]] — degenerate, leave raw
    return { spanFrom: node.from - 1, spanTo: node.to + 1, pipe };
  };

  /**
   * Inline links `[text](url)`: the brackets, parens and URL are syntax —
   * hidden; the text stays as real bytes. Reference links (`[a][b]`) have
   * no URL part and stay raw (robustness rule). Split into the opening `[`
   * and the closing `](url)` parts so the (possibly decorated) text
   * between them can emit its own replaces in between.
   */
  const linkParts = (
    node: SyntaxNode,
  ): { open: [number, number]; close: [number, number] } | null => {
    const open = node.firstChild;
    const close = node.lastChild;
    if (!open || !close) return null;
    if (open.name !== "LinkMark" || close.name !== "LinkMark") return null;
    if (doc.sliceString(open.from, open.to) !== "[") return null;
    if (doc.sliceString(close.from, close.to) !== ")") return null;
    const url = close.prevSibling;
    if (!url || url.name !== "URL") return null;
    const paren = url.prevSibling;
    if (!paren || doc.sliceString(paren.from, paren.to) !== "(") return null;
    // The visible text part ends at the `]` mark.
    let closeBracket: SyntaxNode | null = null;
    for (let child = open.nextSibling; child && child !== url; child = child.nextSibling) {
      if (child.name === "LinkMark" && doc.sliceString(child.from, child.to) === "]") {
        closeBracket = child;
      }
    }
    if (!closeBracket) return null;
    return { open: [open.from, open.to], close: [closeBracket.from, node.to] };
  };

  /**
   * Provenance comments must be invisible. Block comments may swallow
   * trailing same-line text, so only the comment bytes themselves are
   * hidden — content after `-->` stays.
   */
  const comment = (node: SyntaxNode): void => {
    const text = doc.sliceString(node.from, node.to);
    if (!text.startsWith("<!--")) return;
    const end = text.lastIndexOf("-->");
    if (end === -1) return;
    pushReplace(node.from, node.from + end + 3);
  };

  /**
   * `<u>`/`</u>` is the storage form for underline — hide ONLY these two
   * inline-HTML tags; every other inline HTML tag stays raw.
   */
  const underlineTag = (node: SyntaxNode): void => {
    const raw = doc.sliceString(node.from, node.to).toLowerCase();
    if (raw !== UNDERLINE_OPEN && raw !== UNDERLINE_CLOSE) return;
    pushReplace(node.from, node.to);
  };

  /**
   * Pair `<u>`…`</u>` sibling tags so the content keeps its underline once
   * the tags are hidden (rendering quality must not regress).
   */
  const underlineSpans = (node: SyntaxNode): void => {
    const opens: number[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name !== "HTMLTag") continue;
      const raw = doc.sliceString(child.from, child.to).toLowerCase();
      if (raw === UNDERLINE_OPEN) opens.push(child.to);
      else if (raw === UNDERLINE_CLOSE && opens.length > 0) {
        pushMark(opens.pop() as number, child.from, "wl-md-underline");
      }
    }
  };

  const walk = (node: SyntaxNode): void => {
    // W1: the frontmatter block is owned by the chip widget.
    if (fmEnd !== null && node.to <= fmEnd) return;
    underlineSpans(node);
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
      case "ATXHeading4":
        heading(node, 4);
        break;
      case "ATXHeading5":
        heading(node, 5);
        break;
      case "ATXHeading6":
        heading(node, 6);
        break;
      case "SetextHeading1":
        // Setext underlines stay raw (phase 1); the text line still styles.
        lineClassFor(doc.lineAt(node.from).number, "wl-md-h1");
        break;
      case "SetextHeading2":
        lineClassFor(doc.lineAt(node.from).number, "wl-md-h2");
        break;
      case "StrongEmphasis":
        inline(node, ["**"], "wl-md-strong");
        break;
      case "Emphasis":
        inline(node, ["*", "_"], "wl-md-em");
        break;
      case "Strikethrough":
        strikethrough(node);
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
      case "Link": {
        const wiki = wikilinkShape(node);
        if (wiki) {
          pushMark(wiki.spanFrom, wiki.spanTo, "wl-md-wikilink");
          pushReplace(wiki.spanFrom, wiki.spanFrom + 2); // [[
          if (wiki.pipe !== -1)
            pushReplace(node.from + 1, node.from + 2 + wiki.pipe); // target|
          pushReplace(wiki.spanTo - 2, wiki.spanTo); // ]]
          break;
        }
        const parts = linkParts(node);
        if (parts) {
          // Interleave: the text between the brackets can carry its own
          // replaces (bold inside a link), which must stay in doc order
          // for the monotonic replace guard.
          pushReplace(parts.open[0], parts.open[1]); // [
          for (let child = node.firstChild; child; child = child.nextSibling)
            walk(child);
          pushReplace(parts.close[0], parts.close[1]); // ](url)
          return;
        }
        break;
      }
      case "Comment":
      case "CommentBlock":
        comment(node);
        break;
      case "HTMLTag":
        underlineTag(node);
        break;
      default:
        break;
    }
    for (let child = node.firstChild; child; child = child.nextSibling) walk(child);
  };

  walk(syntaxNode);
  return Decoration.set(specs, true);
}
