import { describe, expect, it } from "vitest";
import {
  askV1,
  auditV1,
  extractionV1,
  getPrompt,
  latestVersion,
  promptIds,
  toChatMessages,
} from "./index";

describe("prompt suite — versioned data registry", () => {
  it("ships extraction, audit and ask at version 1", () => {
    expect(extractionV1.id).toBe("extraction");
    expect(extractionV1.version).toBe(1);
    expect(auditV1.id).toBe("audit");
    expect(auditV1.version).toBe(1);
    expect(askV1.id).toBe("ask");
    expect(askV1.version).toBe(1);
  });

  it("resolves prompts by (id, version) and reports unknown versions", () => {
    expect(getPrompt("extraction", 1)).toBe(extractionV1);
    expect(getPrompt("audit", 1)).toBe(auditV1);
    expect(getPrompt("ask", 1)).toBe(askV1);
    expect(getPrompt("extraction", 99)).toBeUndefined();
    expect(getPrompt("nope", 1)).toBeUndefined();
  });

  it("exposes latestVersion per prompt id", () => {
    for (const id of promptIds) {
      expect(latestVersion(id)).toBe(1);
    }
    expect(latestVersion("nope")).toBeUndefined();
  });

  it("extraction prompt embeds the note path, title and body in the user turn", () => {
    const messages = toChatMessages(extractionV1, {
      path: "characters/Aelindra.md",
      title: "Aelindra",
      body: "Aelindra slipped into [[Vael'Thor]].",
      type: "character",
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    const user = messages[1].content;
    expect(user).toContain("characters/Aelindra.md");
    expect(user).toContain("Aelindra slipped into [[Vael'Thor]].");
    expect(user).toContain("character");
    // Prompt-injection discipline (PLAN-M2 I3): vault content is marked untrusted.
    expect(messages[0].content.toLowerCase()).toContain("untrusted");
    expect(messages[0].content).toContain('"proposals"');
  });

  it("audit prompt lists every supplied note verbatim", () => {
    const messages = toChatMessages(auditV1, {
      notes: [
        { path: "a.md", title: "A", content: "A was born in 1990." },
        { path: "b.md", title: "B", content: "A was born in 1992." },
      ],
    });

    expect(messages[0].role).toBe("system");
    expect(messages[0].content.toLowerCase()).toContain("untrusted");
    expect(messages[1].content).toContain("a.md");
    expect(messages[1].content).toContain("b.md");
    expect(messages[1].content).toContain("A was born in 1990.");
    expect(messages[1].content).toContain("A was born in 1992.");
  });

  it("ask prompt includes context excerpts and the question, and mandates citations", () => {
    const messages = toChatMessages(askV1, {
      question: "Where was Aelindra born?",
      context: [{ path: "characters/Aelindra.md", excerpt: "Born in Vael'Thor." }],
    });

    expect(messages[0].content).toContain("[[");
    expect(messages[1].content).toContain("characters/Aelindra.md");
    expect(messages[1].content).toContain("Born in Vael'Thor.");
    expect(messages[1].content).toContain("Where was Aelindra born?");
  });
});
