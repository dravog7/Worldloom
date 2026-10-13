import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Note } from "../types";
import {
  buildExtractionMessages,
  estimateMessageTokens,
  estimateTokens,
  extractProposals,
  parseExtractionResponse,
  type ExtractionParseError,
} from "./extract";

const VALID_RESPONSE = JSON.stringify({
  proposals: [
    {
      kind: "entity",
      name: "Aelindra",
      entityType: "character",
      confidence: 0.9,
    },
    { kind: "alias", alias: "The Exile", confidence: 0.8 },
    {
      kind: "relation",
      relationKind: "born_in",
      target: "Vael'Thor",
      confidence: 0.7,
    },
  ],
});

function expectError(
  result: ReturnType<typeof parseExtractionResponse>,
): ExtractionParseError {
  if (result.ok) throw new Error("expected a parse failure");
  return result.error;
}

function noteWith(overrides: Partial<Note>): Pick<
  Note,
  "path" | "title" | "type" | "aliases" | "relations"
> {
  return {
    path: "characters/Aelindra.md",
    title: "Aelindra",
    type: undefined,
    aliases: [],
    relations: [],
    ...overrides,
  };
}

describe("token estimator (chars/4 + overhead)", () => {
  it("estimates ceil(chars/4) tokens with zero overhead by default", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(1000))).toBe(250);
  });

  it("adds a fixed per-message overhead on top of content tokens", () => {
    // Two short messages ("hello" → 2 tokens each) + 4 tokens overhead per message.
    const tokens = estimateMessageTokens([
      { role: "system", content: "hello" },
      { role: "user", content: "hello" },
    ]);
    expect(tokens).toBe(2 * (2 + 4));
  });

  it("stays within ±25% of the chars/4 heuristic on real fixture notes", () => {
    const root = join(process.cwd(), "fixtures", "vault-sample");
    const files: string[] = [];
    for (const dir of readdirSync(root)) {
      for (const file of readdirSync(join(root, dir))) {
        if (file.endsWith(".md")) files.push(join(root, dir, file));
      }
    }
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const ideal = text.length / 4;
      const estimate = estimateTokens(text);
      expect(estimate).toBeGreaterThanOrEqual(ideal * 0.75);
      expect(estimate).toBeLessThanOrEqual(ideal * 1.25);
    }
  });
});

describe("buildExtractionMessages", () => {
  it("produces a system + user turn for the given note", () => {
    const messages = buildExtractionMessages({
      path: "characters/Aelindra.md",
      title: "Aelindra",
      body: "She fled the city.",
      type: "character",
    });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("She fled the city.");
  });
});

describe("parseExtractionResponse — valid model output", () => {
  it("parses a wrapped proposal list of all three kinds", () => {
    const result = parseExtractionResponse(VALID_RESPONSE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toEqual([
      {
        kind: "entity",
        name: "Aelindra",
        entityType: "character",
        confidence: 0.9,
      },
      { kind: "alias", alias: "The Exile", confidence: 0.8 },
      {
        kind: "relation",
        relationKind: "born_in",
        target: "Vael'Thor",
        confidence: 0.7,
      },
    ]);
  });

  it("accepts a bare top-level array and clamps out-of-range confidence", () => {
    const result = parseExtractionResponse(
      JSON.stringify([
        { kind: "alias", alias: "  The Exile  ", confidence: 1.4 },
        { kind: "alias", alias: "Aeli", confidence: -0.3 },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toEqual([
      { kind: "alias", alias: "The Exile", confidence: 1 },
      { kind: "alias", alias: "Aeli", confidence: 0 },
    ]);
  });

  it("unwraps a markdown-fenced JSON payload", () => {
    const fenced = "```json\n" + VALID_RESPONSE + "\n```";
    const result = parseExtractionResponse(fenced);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toHaveLength(3);
  });

  it("returns an empty proposal list for an empty proposals array", () => {
    const result = parseExtractionResponse('{"proposals":[]}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toEqual([]);
    expect(result.droppedDuplicates).toBe(0);
  });

  it("collapses within-list duplicates, keeping the highest confidence", () => {
    const result = parseExtractionResponse(
      JSON.stringify([
        { kind: "alias", alias: "The Exile", confidence: 0.4 },
        { kind: "alias", alias: "the exile", confidence: 0.9 },
        {
          kind: "relation",
          relationKind: "born_in",
          target: "Vael'Thor",
          confidence: 0.5,
        },
        {
          kind: "relation",
          relationKind: "Born_In",
          target: "vael'thor",
          confidence: 0.6,
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toEqual([
      { kind: "alias", alias: "the exile", confidence: 0.9 },
      {
        kind: "relation",
        relationKind: "Born_In",
        target: "vael'thor",
        confidence: 0.6,
      },
    ]);
    expect(result.droppedDuplicates).toBe(2);
  });
});

describe("parseExtractionResponse — strict failures (typed error, never throws)", () => {
  it("rejects prose that is not JSON", () => {
    for (const junk of ["", "I could not find anything.", "{oops", "null", "42"]) {
      expect(() => parseExtractionResponse(junk)).not.toThrow();
      const error = expectError(parseExtractionResponse(junk));
      expect(error.name).toBe("ExtractionParseError");
      expect(["not-json", "invalid-shape"]).toContain(error.kind);
    }
  });

  it("rejects a JSON root that is neither an array nor a proposals wrapper", () => {
    const error = expectError(
      parseExtractionResponse('{"result":"see analysis"}'),
    );
    expect(error.kind).toBe("invalid-shape");
  });

  it("rejects an entry with an unknown kind and reports its index", () => {
    const error = expectError(
      parseExtractionResponse(
        JSON.stringify([
          { kind: "alias", alias: "Fine", confidence: 0.5 },
          { kind: "prophecy", text: "???", confidence: 0.5 },
        ]),
      ),
    );
    expect(error.kind).toBe("invalid-entry");
    expect(error.entryIndex).toBe(1);
  });

  it("rejects non-numeric or missing confidence", () => {
    for (const bad of ["high", undefined, null, Number.NaN]) {
      const error = expectError(
        parseExtractionResponse(
          JSON.stringify([{ kind: "alias", alias: "A", confidence: bad }]),
        ),
      );
      expect(error.kind).toBe("invalid-entry");
      expect(error.entryIndex).toBe(0);
    }
  });

  it("rejects blank required strings", () => {
    const error = expectError(
      parseExtractionResponse(
        JSON.stringify([{ kind: "alias", alias: "   ", confidence: 0.5 }]),
      ),
    );
    expect(error.kind).toBe("invalid-entry");
  });

  it("rejects oversized responses before attempting a parse", () => {
    const huge = '{"proposals":[' + "x".repeat(500) + "]}";
    const error = expectError(
      parseExtractionResponse(huge, { maxChars: 100 }),
    );
    expect(error.kind).toBe("oversized");
  });
});

describe("extractProposals — dedupe against existing frontmatter", () => {
  it("drops aliases and relations the note already has (case-insensitive)", () => {
    const result = extractProposals(
      noteWith({
        type: "character",
        aliases: ["The Exile"],
        relations: [{ kind: "born_in", target: "Vael'Thor" }],
      }),
      JSON.stringify([
        { kind: "alias", alias: "the exile", confidence: 0.9 },
        { kind: "alias", alias: "Aeli", confidence: 0.85 },
        {
          kind: "relation",
          relationKind: "Born_In",
          target: "vael'thor",
          confidence: 0.9,
        },
        {
          kind: "relation",
          relationKind: "allied_with",
          target: "Halden",
          confidence: 0.6,
        },
        {
          kind: "entity",
          name: "Aelindra",
          entityType: "character",
          confidence: 0.95,
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toEqual([
      { kind: "alias", alias: "Aeli", confidence: 0.85 },
      {
        kind: "relation",
        relationKind: "allied_with",
        target: "Halden",
        confidence: 0.6,
      },
    ]);
    expect(result.droppedDuplicates).toBe(3);
  });

  it("drops an alias that merely repeats the note title", () => {
    const result = extractProposals(
      noteWith({ title: "Aelindra" }),
      JSON.stringify([
        { kind: "alias", alias: "Aelindra", confidence: 0.9 },
        { kind: "alias", alias: "The Exile", confidence: 0.7 },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposals).toEqual([
      { kind: "alias", alias: "The Exile", confidence: 0.7 },
    ]);
  });

  it("propagates strict parse failures untouched", () => {
    const result = extractProposals(noteWith({}), "not json at all");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-json");
  });
});
