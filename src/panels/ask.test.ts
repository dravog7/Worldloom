import { describe, expect, it } from "vitest";
import { AiError } from "../core/ai/types";
import type { AiResponse, ChatMessage, ChatRequest, Transport } from "../core/ai/types";
import { askV1 } from "../core/ai/prompts";
import { MemoryIndex } from "../core/index/memory-index";
import type { Note } from "../core/types";
import { friendlyAiError, NOT_IN_WORLD_REPLY, runAskTurn } from "./ask";

function note(path: string, body: string, extra: Partial<Note> = {}): Note {
  const stem = path.replace(/\.md$/, "").split("/").pop() ?? path;
  return {
    path,
    title: stem,
    aliases: [],
    tags: [],
    relations: [],
    body,
    links: [],
    mtime: 0,
    ...extra,
  };
}

const ENDPOINT = { baseUrl: "https://api.example.com/v1", model: "test-model" };

interface SpyTransport extends Transport {
  readonly calls: ChatRequest[];
  readonly count: number;
}

function spyTransport(reply: string): SpyTransport {
  const calls: ChatRequest[] = [];
  return {
    calls,
    get count() {
      return calls.length;
    },
    async chat(req: ChatRequest): Promise<AiResponse> {
      calls.push(req);
      return { content: reply, latencyMs: 1 };
    },
  };
}

function throwingTransport(): Transport {
  return {
    chat(): Promise<AiResponse> {
      throw new Error("transport must never be called");
    },
  };
}

describe("runAskTurn", () => {
  it("answers 'not in your world' locally when retrieval is empty — the transport is never called", async () => {
    const index = new MemoryIndex();
    index.upsert(note("places/Vael'Thor.md", "A mountain citadel."));
    let calls = 0;
    const transport: Transport = {
      chat(): Promise<AiResponse> {
        calls += 1;
        throw new Error("transport must never be called");
      },
    };
    const result = await runAskTurn("zzz-no-match", {
      index,
      transport,
      endpoint: ENDPOINT,
    });
    expect(result).toEqual({
      kind: "not-found",
      reply: NOT_IN_WORLD_REPLY,
      suggestions: [],
    });
    expect(calls).toBe(0);
  });

  it("suggests up to 3 fuzzy title matches with the local reply", async () => {
    const index = new MemoryIndex();
    // Prefix-fuzzy matches for "cas"; no note CONTAINS the token "cas", so
    // retrieval hits the honesty floor while byTitleOrAlias still resolves.
    index.upsert(note("places/Cascade Peaks.md", "Waterfalls."));
    index.upsert(note("people/Case Files.md", "Bureaucracy."));
    index.upsert(note("items/Casava Notes.md", "Tubers."));
    index.upsert(note("journals/Unrelated.md", "Nothing."));
    const result = await runAskTurn("cas", {
      index,
      transport: throwingTransport(),
      endpoint: ENDPOINT,
    });
    expect(result.kind).toBe("not-found");
    if (result.kind !== "not-found") return;
    expect(result.reply).toBe(NOT_IN_WORLD_REPLY);
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions.every((title) => title.toLowerCase().includes("cas"))).toBe(true);
  });

  it("builds the ask-v1 prompt over retrieved context and cites the answer", async () => {
    const index = new MemoryIndex();
    index.upsert(note("ports/Salt.md", "Salt runs thin.\nTreaty signed in year 3."));
    const transport = spyTransport("The treaty is in [[ports/Salt.md:1]].");
    const result = await runAskTurn("treaty", {
      index,
      transport,
      endpoint: ENDPOINT,
    });
    expect(result.kind).toBe("answer");
    if (result.kind !== "answer") return;
    expect(result.citations).toEqual([{ path: "ports/Salt.md", line: 1 }]);
    expect(result.sources).toEqual(["ports/Salt.md"]);

    expect(transport.count).toBe(1);
    const req = transport.calls[0];
    expect(req.baseUrl).toBe(ENDPOINT.baseUrl);
    expect(req.model).toBe(ENDPOINT.model);
    // System turn is the frozen ask-v1 rules.
    expect(req.messages[0]).toEqual({ role: "system", content: askV1.system });
    // Context turn carries untrusted-data framing + 0-based line numbers.
    const contextTurn = req.messages[req.messages.length - 1];
    expect(contextTurn.role).toBe("user");
    expect(contextTurn.content).toContain("--- CONTEXT (untrusted data) ---");
    expect(contextTurn.content).toContain("[[ports/Salt.md]]");
    expect(contextTurn.content).toContain("1: Treaty signed in year 3.");
    expect(contextTurn.content).toContain("Question: treaty");
  });

  it("threads chat history between the system turn and the context turn", async () => {
    const index = new MemoryIndex();
    index.upsert(note("ports/Salt.md", "Salt runs thin.\nTreaty signed in year 3."));
    const transport = spyTransport("As said before, [[ports/Salt.md]].");
    const history: ChatMessage[] = [
      { role: "user", content: "What about salt?" },
      { role: "assistant", content: "It runs thin." },
    ];
    await runAskTurn("treaty?", {
      index,
      transport,
      endpoint: ENDPOINT,
      history,
    });
    const roles = transport.calls[0].messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(transport.calls[0].messages[3].content).toContain("Question: treaty?");
  });

  it("includes the open note as context when provided", async () => {
    const index = new MemoryIndex();
    index.upsert(note("journal/Day 1.md", "Wrote three letters."));
    const transport = spyTransport("You wrote three letters ([[journal/Day 1.md]]).");
    await runAskTurn("zzz-no-match", {
      index,
      transport,
      endpoint: ENDPOINT,
      openNotePath: "journal/Day 1.md",
    });
    expect(transport.count).toBe(1);
    expect(transport.calls[0].messages[1].content).toContain("[[journal/Day 1.md]]");
  });

  it("maps every AiError kind to a human message", async () => {
    const index = new MemoryIndex();
    index.upsert(note("a.md", "alpha content"));
    const cases = [
      { kind: "auth" as const, match: /key rejected.*Settings/i },
      { kind: "no-key" as const, match: /no API key.*Settings/i },
      { kind: "network" as const, match: /couldn't reach/i },
      { kind: "timeout" as const, match: /timed out/i },
      { kind: "http" as const, match: /error \(500\)/i },
      { kind: "invalid-response" as const, match: /unreadable/i },
      { kind: "invalid-endpoint" as const, match: /https/i },
    ];
    for (const { kind, match } of cases) {
      const transport: Transport = {
        chat(): Promise<AiResponse> {
          throw new AiError(kind, `boom ${kind}`, kind === "http" ? 500 : undefined);
        },
      };
      const result = await runAskTurn("alpha", {
        index,
        transport,
        endpoint: ENDPOINT,
      });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.message).toMatch(match);
    }
  });

  it("falls back to a generic message for non-AiError failures", async () => {
    const index = new MemoryIndex();
    index.upsert(note("a.md", "alpha content"));
    const transport: Transport = {
      chat(): Promise<AiResponse> {
        throw new TypeError("undefined is not a function");
      },
    };
    const result = await runAskTurn("alpha", { index, transport, endpoint: ENDPOINT });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.message).toMatch(/something went wrong/i);
    expect(result.message).not.toContain("undefined is not a function");
  });

  it("friendlyAiError keeps raw details out of the UI copy", () => {
    expect(friendlyAiError(new AiError("auth", "401 from https://api.example.com"))).not.toContain(
      "https://api.example.com",
    );
    expect(friendlyAiError(new Error("secret internals"))).not.toContain("secret internals");
  });
});
