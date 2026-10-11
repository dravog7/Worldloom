import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WindowLike } from "dompurify";
import { renderMarkdown, sanitizeHtml, setSanitizerWindowForTests } from "./render";

// jsdom ships no bundled types; load it through createRequire so typecheck
// stays clean while the tests still get a real DOM for DOMPurify.
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as {
  JSDOM: new (html?: string) => { window: Window };
};

const jsdomWindow = new JSDOM("").window as unknown as WindowLike;

beforeAll(() => {
  setSanitizerWindowForTests(jsdomWindow);
});

afterAll(() => {
  setSanitizerWindowForTests(undefined);
});

describe("renderMarkdown — wikilink rule (PLAN-M1 C2)", () => {
  it("converts [[Target]] to a wl-link anchor with data-wl-target and reports the link", () => {
    const { html, links } = renderMarkdown("See [[Vael'Thor]] here.");

    expect(html).toContain('<a class="wl-link" data-wl-target="Vael\'Thor" href="#">');
    expect(html).toContain(">Vael'Thor</a>");
    expect(links).toEqual([{ target: "Vael'Thor", display: "Vael'Thor" }]);
  });

  it("uses the pipe display text but keeps the raw target in data-wl-target", () => {
    const { html, links } = renderMarkdown("Met [[Aelindra|the Exile]] at dawn.");

    expect(html).toContain('data-wl-target="Aelindra"');
    expect(html).toContain(">the Exile</a>");
    expect(links).toEqual([{ target: "Aelindra", display: "the Exile" }]);
  });

  it("keeps multiple wikilinks in source order (anchors and link list)", () => {
    const { html, links } = renderMarkdown(
      "[[First]] then [[Second|two]] and [[Third]].",
    );

    expect(links).toEqual([
      { target: "First", display: "First" },
      { target: "Second", display: "two" },
      { target: "Third", display: "Third" },
    ]);
    const targets = [...html.matchAll(/data-wl-target="([^"]*)"/g)].map(
      (match) => match[1],
    );
    expect(targets).toEqual(["First", "Second", "Third"]);
  });

  it("treats an empty pipe display as a fallback to the target", () => {
    const { links } = renderMarkdown("See [[Target|]] here.");

    expect(links).toEqual([{ target: "Target", display: "Target" }]);
  });

  it("leaves empty-target wikilinks [[ ]] as literal text", () => {
    const { html, links } = renderMarkdown("Broken [[]] and [[ ]] links.");

    expect(html).not.toContain("wl-link");
    expect(links).toEqual([]);
  });

  it("does not convert wikilinks inside fenced code blocks", () => {
    const { html, links } = renderMarkdown(
      ["```ts", "const link = '[[NotALink]]';", "```"].join("\n"),
    );

    expect(links).toEqual([]);
    expect(html).not.toContain("data-wl-target");
    expect(html).toContain("<pre><code");
    expect(html).toContain("[[NotALink]]");
  });
});

describe("renderMarkdown — markdown + sanitization", () => {
  it("escapes raw HTML in the markdown source instead of executing it", () => {
    const { html } = renderMarkdown('before <script>alert("xss")</script> after');

    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders headings, strong emphasis, and lists", () => {
    const { html } = renderMarkdown("# Title\n\n**bold** and text\n\n- one\n- two");

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<ul>");
    expect(html).toMatch(/<li>[oa]ne<\/li>/);
    expect(html).toContain("<li>two</li>");
  });

  it("preserves fenced code as escaped code, never as markup", () => {
    const { html } = renderMarkdown(["```js", "const a = '<b>';", "```"].join("\n"));

    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain("const a = '&lt;b&gt;';");
  });
});

describe("sanitizeHtml — DOMPurify + href allowlist", () => {
  it("strips javascript: hrefs from the output entirely", () => {
    const html = sanitizeHtml('<p><a href="javascript:alert(1)">click</a></p>');

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("href");
    expect(html).toContain(">click</a>");
  });

  it("rewrites surviving hrefs outside the allowlist (ftp, relative paths) to '#'", () => {
    const html = sanitizeHtml(
      '<a href="ftp://example.com">a</a> <a href="../notes/foo.md">b</a>',
    );

    expect(html).not.toContain("ftp:");
    expect(html).not.toContain("foo.md");
    expect(html.match(/href="#"/g)).toHaveLength(2);
  });

  it("neutralizes img onerror payloads", () => {
    const html = sanitizeHtml('<img src="x" onerror="alert(1)">');

    expect(html).not.toContain("onerror");
  });

  it("keeps #, http(s) and mailto hrefs untouched", () => {
    const html = sanitizeHtml(
      '<a href="#sec">a</a> <a href="https://example.com">b</a> ' +
        '<a href="http://example.com">c</a> <a href="mailto:x@y.z">d</a>',
    );

    expect(html).toContain('href="#sec"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="http://example.com"');
    expect(html).toContain('href="mailto:x@y.z"');
  });

  it("keeps class and data-wl-target attributes through sanitization", () => {
    const html = sanitizeHtml('<a class="wl-link" data-wl-target="T" href="#">T</a>');

    expect(html).toContain('class="wl-link"');
    expect(html).toContain('data-wl-target="T"');
  });

  it("fails loudly when no DOM is available instead of shipping unsanitized HTML", () => {
    setSanitizerWindowForTests(undefined);
    try {
      expect(() => renderMarkdown("# x")).toThrow(/DOM/);
    } finally {
      setSanitizerWindowForTests(jsdomWindow);
    }
  });
});
