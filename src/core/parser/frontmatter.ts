/**
 * Frontmatter v1 subset parser (ADR-002) — dependency-free, browser-safe.
 *
 * WHY NOT gray-matter (replaces it, M2-e2e era): gray-matter's YAML engine
 * calls Node's `Buffer`, which Vite externalizes in the browser
 * ("Module buffer has been externalized… Cannot access buffer.Buffer"),
 * so in the real WebView EVERY note silently parsed as frontmatter-less —
 * aliases/tags/relations never reached the index, the properties popover
 * showed dashes, and the audit missed alias-based findings. The e2e suite
 * caught it; this module is the fix. The v1 schema is frozen (ADR-002), so
 * a strict subset parser with a malformed→absent fallback is both smaller
 * and *more* predictable than a general YAML engine in a browser bundle.
 *
 * Supported subset (exactly what the v1 schema uses):
 *   key: scalar              (bare / 'single' / "double" quoted)
 *   key: [a, b, "c d"]       (flow sequence of scalars)
 *   key:                     (block sequence of scalars)
 *     - item
 *   key:                     (block sequence of maps — `relations`)
 *     - kind: born_in
 *       target: "Vael'Thor"
 *   key:                     (nested mapping — `temporal`)
 *     from: "Age of Ash"
 *
 * Any other shape throws → the caller falls back to "no frontmatter"
 * (the ADR-002 tolerance contract: malformed YAML never crashes a note).
 */

export interface FrontmatterResult {
  data: Record<string, unknown>;
  /** Body exactly as gray-matter would leave it: everything after the closing `---\n`. */
  body: string;
  /** Lines consumed by the block (for wikilink line offsets against the whole file). */
  lineOffset: number;
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/;
const SEQ_ITEM_RE = /^-[ \t]+(.*)$/;
const NUM_RE = /^-?\d+(?:\.\d+)?$/;

/** YAML scalar typing: quoted → always string; bare true/false/number typed, else string. */
function parseScalar(raw: string): unknown {
  const text = raw.trim();
  if (text.length >= 2) {
    const q = text[0];
    if ((q === '"' || q === "'") && text[text.length - 1] === q) {
      return text.slice(1, -1);
    }
  }
  // Flow mappings (`{{`) and anchors/aliases/tags are outside the v1 subset —
  // treat them as malformed (the parser.test tolerance case pins this).
  if (text.startsWith("{") || text.startsWith("&") || text.startsWith("*") || text.startsWith("!")) {
    throw new Error(`unsupported YAML construct: ${text}`);
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (NUM_RE.test(text)) return Number(text);
  return text;
}

/** Split a flow sequence body on top-level commas; throws on unterminated/nested. */
function parseFlowSequence(body: string): unknown[] {
  const items: unknown[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote !== "") {
      if (ch === quote) quote = "";
      continue;
    }
    // A quote only OPENS a string at token start — mid-token apostrophes
    // (vael'thor spire, O'Brien) are literal characters.
    const tokenStart = i === start || body[i - 1] === "," || body[i - 1] === "[";
    if ((ch === '"' || ch === "'") && tokenStart) { quote = ch; continue; }
    if (ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      items.push(parseScalar(body.slice(start, i)));
      start = i + 1;
    }
    if (depth < 0) throw new Error("unbalanced flow sequence");
  }
  if (quote !== "") throw new Error("unterminated quote in flow sequence");
  if (depth !== 0) throw new Error("unterminated flow sequence");
  const tail = body.slice(start).trim();
  if (tail !== "") items.push(parseScalar(tail));
  return items;
}

/** Column indent of a line (tabs are not valid YAML indentation). */
function indentOf(line: string): number {
  const match = /^[ ]*/.exec(line);
  const indent = match ? match[0].length : 0;
  if (line.slice(indent, indent + 1) === "\t") throw new Error("tab indentation");
  return indent;
}

/**
 * Parse the lines between the `---` fences into a mapping.
 * Line-oriented recursive descent over the subset above; anything unexpected
 * throws (tolerance lives in the caller).
 */
function parseBlock(lines: string[], baseIndent = 0): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let i = 0;

  const readIndentedBlock = (parentIndent: number): string[] => {
    const block: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        block.push(line);
        i += 1;
        continue;
      }
      if (indentOf(line) <= parentIndent) break;
      block.push(line);
      i += 1;
    }
    // Trailing blanks belong to the parent, not the block.
    while (block.length > 0 && block[block.length - 1].trim() === "") {
      block.pop();
      i -= 1;
    }
    return block;
  };

  const parseSequence = (block: string[], seqIndent: number): unknown[] => {
    const items: unknown[] = [];
    let j = 0;
    while (j < block.length) {
      const line = block[j];
      const itemIndent = indentOf(line);
      const itemMatch = SEQ_ITEM_RE.exec(line.slice(itemIndent));
      if (itemMatch === null || itemIndent !== seqIndent) {
        throw new Error("malformed sequence item");
      }
      const first = itemMatch[1];
      const keyValue = KEY_RE.exec(first);
      if (keyValue !== null) {
        // Map item: first pair rides the `-` line; siblings are deeper-indented.
        const map: Record<string, unknown> = {};
        const applyPair = (key: string, value: string, keyIndent = itemIndent) => {
          if (value.trim() === "") {
            const sub = readIndentedBlock(keyIndent);
            map[key] = sub.length > 0 ? parseBlock(sub, indentOf(sub.find((l) => l.trim() !== "") ?? "  ")) : null;
          } else {
            map[key] = parseScalar(value);
          }
        };
        applyPair(keyValue[1], keyValue[2]);
        j += 1;
        while (j < block.length) {
          const next = block[j];
          const nextIndent = indentOf(next);
          if (next.trim() === "") { j += 1; continue; }
          if (nextIndent <= itemIndent) break;
          const pair = KEY_RE.exec(next.slice(nextIndent));
          if (pair === null) throw new Error("malformed map entry in sequence item");
          applyPair(pair[1], pair[2], nextIndent);
          j += 1;
        }
        items.push(map);
      } else {
        items.push(parseScalar(first));
        j += 1;
      }
    }
    return items;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i += 1; continue; }
    const indent = indentOf(line);
    if (indent !== baseIndent) throw new Error("inconsistent key indentation");
    const pair = KEY_RE.exec(line.slice(indent));
    if (pair === null) throw new Error(`not a key: value line: ${line}`);
    const [, key, rest] = pair;
    if (rest.trim() === "") {
      // Step past the key line so the reader starts at its value block.
      i += 1;
      const block = readIndentedBlock(baseIndent);
      if (block.length === 0) {
        data[key] = null;
      } else {
        const firstNonBlank = block.find((l) => l.trim() !== "") ?? "";
        if (SEQ_ITEM_RE.test(firstNonBlank.slice(indentOf(firstNonBlank)))) {
          const seqIndent = indentOf(firstNonBlank);
          data[key] = parseSequence(block, seqIndent);
        } else {
          data[key] = parseBlock(block, indentOf(firstNonBlank));
        }
      }
      // readIndentedBlock already left `i` on the next unindented line —
      // the loop's trailing i+=1 would skip that key entirely.
      continue;
    } else if (rest.trim().startsWith("[")) {
      const trimmed = rest.trim();
      if (!trimmed.endsWith("]")) throw new Error("unterminated flow sequence");
      data[key] = parseFlowSequence(trimmed.slice(1, -1));
    } else {
      data[key] = parseScalar(rest);
    }
    i += 1;
  }
  return data;
}

/** Strings that need quoting in emitted YAML (specials, look-numeric, empty). */
function scalarNeedsQuotes(text: string): boolean {
  if (text === "") return true;
  if (NUM_RE.test(text) || text === "true" || text === "false") return true;
  // Safe bare: word chars, spaces, and the punctuation the v1 schema uses in
  // titles/targets (slashes, apostrophes, parens, dots, hyphens, commas...).
  return !/^[\w ./'()\-+,!&*#<>|]+$/.test(text) || /: /.test(text) || text.endsWith(":");
}

function emitScalar(value: unknown): string {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  return scalarNeedsQuotes(text) ? JSON.stringify(text) : text;
}

/**
 * Serialize a v1-subset mapping back to fenced markdown. Round-trips through
 * parseFrontmatter (the accept-extract tests assert via parseNote, so the
 * exact YAML style is free — flow sequences for scalar lists, block style
 * for maps and map-lists, unknown keys preserved by the caller's spread).
 */
export function stringifyFrontmatter(body: string, data: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  const emit = (key: string, value: unknown, indent: string): void => {
    if (value === null || value === undefined) {
      lines.push(`${indent}${key}:`);
      return;
    }
    if (Array.isArray(value)) {
      if (value.every((v) => v === null || typeof v !== "object")) {
        lines.push(`${indent}${key}: [${value.map(emitScalar).join(", ")}]`);
      } else {
        lines.push(`${indent}${key}:`);
        for (const item of value) {
          if (item !== null && typeof item === "object" && !Array.isArray(item)) {
            const entries = Object.entries(item as Record<string, unknown>);
            entries.forEach(([k, v], idx) => {
              const prefix = idx === 0 ? `${indent}  - ` : `${indent}    `;
              if (v !== null && typeof v === "object") {
                lines.push(`${prefix}${k}:`); // nested-inside-seq: unsupported in v1
              } else {
                lines.push(`${prefix}${k}: ${emitScalar(v)}`);
              }
            });
          } else {
            lines.push(`${indent}  - ${emitScalar(item)}`);
          }
        }
      }
      return;
    }
    if (typeof value === "object") {
      lines.push(`${indent}${key}:`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v !== null && typeof v === "object") continue; // v1 has no deeper nesting
        lines.push(`${indent}  ${k}: ${emitScalar(v)}`);
      }
      return;
    }
    lines.push(`${indent}${key}: ${emitScalar(value)}`);
  };
  for (const [key, value] of Object.entries(data)) emit(key, value, "");
  lines.push("---");
  const fence = lines.join("\n");
  return body === "" ? `${fence}\n` : `${fence}\n${body}`;
}

/**
 * True when the content OPENS with a frontmatter fence — regardless of
 * whether what follows parses. Callers that must distinguish "absent"
 * (safe to add frontmatter) from "present but malformed" (unsafe to
 * rewrite, e.g. accept-extract) combine this with parseFrontmatter's null.
 */
export function hasFrontmatterFence(content: string): boolean {
  const source = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const first = source.split(/\r\n|\n/)[0];
  return first !== undefined && first.trim() === "---";
}

/**
 * Split `---` fences and parse the v1 subset. Returns null when the note has
 * no (usable) frontmatter — including every malformed case, per ADR-002.
 */
export function parseFrontmatter(content: string): FrontmatterResult | null {
  const source = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const open = /^---[ \t]*(?:\r\n|\n|\r)/.exec(source);
  if (open === null) return null;
  // Closing fence = a line that is exactly `---` (trailing spaces allowed).
  // Scanned on the raw source so the BODY keeps its original bytes and
  // mixed line endings (CRLF bodies under LF fences) survive verbatim.
  const closeRe = /^(?:\r\n|\n|\r)?---[ \t]*(?=\r\n|\n|\r|$)/gm;
  closeRe.lastIndex = open.index + open[0].length;
  // The FIRST `---` line after the opening is the closing fence (gray-matter
  // semantics; `---` at column 0 inside the block is malformed YAML anyway).
  const closeMatch = closeRe.exec(source);
  if (closeMatch === null) return null;
  const fmText = source.slice(open[0].length, closeMatch.index);
  // Body starts after the closing fence LINE INCLUDING its terminator
  // (gray-matter semantics: no stray leading newline in the body).
  let afterClose = closeRe.lastIndex;
  if (source[afterClose] === "\r" && source[afterClose + 1] === "\n") afterClose += 2;
  else if (source[afterClose] === "\r" || source[afterClose] === "\n") afterClose += 1;
  const body = afterClose >= source.length ? "" : source.slice(afterClose);
  // Same formula the gray-matter era used: consumed lines = whole-file line
  // count minus body line count (keeps wikilink offsets identical).
  const lineOffset =
    source.split("\n").length - (body === "" ? 1 : body.split("\n").length);
  try {
    const eol = fmText.includes("\r\n") ? "\r\n" : fmText.includes("\r") ? "\r" : "\n";
    const lines = fmText.split(eol);
    if (lines.length === 1 && lines[0].trim() === "") {
      return { data: {}, body, lineOffset };
    }
    const data = parseBlock(lines);
    return { data, body, lineOffset };
  } catch {
    // Malformed YAML — ADR-002 tolerance: no frontmatter, body as-is.
    return null;
  }
}
