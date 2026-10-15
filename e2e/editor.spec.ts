/**
 * Wave E2 — thorough EDITOR suite (Playwright) against the proven E1 harness.
 * Boots the real app (vite dev) with the mocked Tauri bridge and exercises
 * the W1–W4 editor rework end to end:
 *   - W1 total syntax hiding (decorations), frontmatter → 'Note properties'
 *     chip + popover, Ctrl+Shift+M raw-source escape hatch;
 *   - W2 Word toolbar (contract, caret reflection, every action's storage
 *     form through the 800ms autosave seam);
 *   - W3 behaviors keymap (list continuation/increment, empty-item exit,
 *     quote continuation, heading-Enter, Tab/Shift+Tab, backspace unwrap +
 *     heading demote chain);
 *   - C1 surfaces: wikilink autocomplete, Ctrl+K search palette;
 *   - M2 panels: offline audit findings (dismiss + tombstone + quote
 *     reveal), backlinks navigation; autosave status chip + doc-sync rule.
 *
 * Every selector was read from the source under test (src/editor/live/*,
 * src/panels/*, src/App.tsx) and every assertion was proven green against
 * a live run. Fixture-specific strings (Aelindra, Misthollow, the seeded
 * 'Order of the Pale Hand' dead link, …) come from fixtures/vault-sample
 * and are pinned by src/core/audit/rules.test.ts.
 */
import { test, expect, type Page } from "@playwright/test";
import { initTauriMock, VAULT_ROOT } from "./harness";

/* ------------------------------------------------------------------ */
/* Paths + fixture facts                                               */
/* ------------------------------------------------------------------ */

const AELINDRA = `${VAULT_ROOT}/characters/Aelindra.md`;
const SCRATCH = `${VAULT_ROOT}/characters/E2 Scratch.md`;
const SCRATCH_TREE_NAME = "E2 Scratch";

/** Scratch note: every construct W1 hides, seeded through the VFS hook. */
const SCRATCH_BODY = [
  "# Scratch heading",
  "",
  "Seed paragraph with `wardcode` and **strong word** and <u>undered</u> and ~~struck~~.",
  "",
  "> quoted line one",
  "> quoted line two",
  "",
  "- bullet alpha",
  "- bullet beta",
  "",
  "1. ordered one",
  "2. ordered two",
  "",
  "---",
  "",
  "```text",
  "fence plain",
  "```",
  "",
  "End [[Vael'Thor|the city]] here.",
].join("\n");

/* ------------------------------------------------------------------ */
/* Tiny local helpers over the E1 harness hooks                        */
/* ------------------------------------------------------------------ */

interface HookedWindow extends Window {
  __e2e_fs_read(path: string): Promise<string>;
  __e2e_fs_write(path: string, content: string): void;
  __e2e_watch_fire(path: string, kind: "create" | "update" | "remove"): void;
}

const editor = (page: Page) => page.locator(".cm-content");
const styleSelect = (page: Page) => page.getByLabel("Text style");
const toggle = (page: Page, label: string) =>
  page.getByRole("button", { name: label, exact: true });
const tree = (page: Page) => page.getByRole("tree", { name: "Vault files" });

test.beforeEach(async ({ page }) => {
  await initTauriMock(page);
});

/** Boot → fixture vault tree visible (E1-proven selectors). */
async function boot(page: Page): Promise<void> {
  await page.goto("/");
  await expect(tree(page)).toBeVisible();
  await expect(page.getByText("Opening vault…")).toHaveCount(0);
}

/** Expand a category folder, open a note, wait for the editor. */
async function openNote(page: Page, folder: string, name: string): Promise<void> {
  await tree(page).getByRole("treeitem", { name: folder }).click();
  await tree(page).getByRole("treeitem", { name }).click();
  await expect(editor(page)).toBeVisible();
}

async function openAelindra(page: Page): Promise<void> {
  await boot(page);
  await openNote(page, "characters", "Aelindra");
  await expect(editor(page)).toContainText("Aelindra Vael");
}

/**
 * Seed a note into the copy-on-write VFS and surface it through the fs
 * watcher (the E1-proven external-change seam), then open it.
 */
async function seedAndOpenScratch(page: Page): Promise<void> {
  await boot(page);
  await page.evaluate(
    ([path, body]) => {
      const w = window as unknown as HookedWindow;
      w.__e2e_fs_write(path, body);
      w.__e2e_watch_fire(path, "create");
    },
    [SCRATCH, SCRATCH_BODY] as const,
  );
  await openNote(page, "characters", SCRATCH_TREE_NAME);
  await expect(editor(page)).toContainText("Seed paragraph");
}

/** Put the caret at the document end of the open note. */
async function caretToEnd(page: Page): Promise<void> {
  await editor(page).click();
  await page.keyboard.press("Control+End");
}

interface DiskExpect {
  /** Substrings the file must contain (after the 800ms autosave). */
  includes?: string[];
  /** Substrings the file must NOT contain. */
  excludes?: string[];
  /** Whole lines the file must contain exactly. */
  lines?: string[];
}

/** Wait until the note's VFS bytes satisfy the expectation (autosave). */
async function waitForDisk(page: Page, path: string, want: DiskExpect): Promise<void> {
  await page.waitForFunction(
    (arg: { path: string; want: DiskExpect }) =>
      (window as unknown as HookedWindow)
        .__e2e_fs_read(arg.path)
        .then((text) => {
          const lines = text.split("\n");
          return (
            (arg.want.includes ?? []).every((needle) => text.includes(needle)) &&
            (arg.want.excludes ?? []).every((needle) => !text.includes(needle)) &&
            (arg.want.lines ?? []).every((line) => lines.includes(line))
          );
        }),
    { path, want },
  );
}

/** Text of the line the caret currently sits on (for reveal assertions). */
function caretLineText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const selection = document.getSelection();
    let node: Node | null = selection?.anchorNode ?? null;
    while (node && !(node instanceof HTMLElement && node.classList.contains("cm-line"))) {
      node = node.parentNode;
    }
    return node instanceof HTMLElement ? (node.textContent ?? "") : "";
  });
}

/* ================================================================== */
/* W1 — live decorations                                              */
/* ================================================================== */

test.describe("live view decorations", () => {
  test("hides every markdown marker in a fixture note and styles the constructs", async ({
    page,
  }) => {
    await openAelindra(page);
    const surface = editor(page);

    // Content stays readable …
    await expect(surface).toContainText("Aelindra Vael");
    await expect(surface).toContainText("The Exile"); // bold content
    await expect(surface).toContainText("grey-green");
    await expect(surface).toContainText("The Night of Cinders"); // pipe display
    // … while every storage byte of syntax is hidden, unconditionally:
    await expect(surface).not.toContainText("**");
    await expect(surface).not.toContainText("[[");
    await expect(surface).not.toContainText("|");
    await expect(surface).not.toContainText("# Aelindra");
    await expect(surface).not.toContainText("---");
    await expect(surface).not.toContainText("aliases:");
    await expect(surface).not.toContainText("type: character");

    // Line classes + spans the decorations emit.
    await expect(surface.locator(".wl-md-h1")).toHaveCount(1);
    await expect(surface.locator(".wl-md-strong").first()).toContainText("The Exile");
    await expect(surface.locator(".wl-md-wikilink").first()).toBeVisible();
  });

  test("replaces the frontmatter block with the Note properties chip and its popover", async ({
    page,
  }) => {
    await openAelindra(page);

    const chip = page.locator(".wl-frontmatter-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("aria-label", "Note properties");
    await expect(chip).toHaveAttribute("contenteditable", "false");
    // Exactly one chip; the YAML block itself is gone from the surface.
    await expect(page.locator(".wl-frontmatter-chip")).toHaveCount(1);
    await expect(editor(page)).not.toContainText("tags: [royalty, act1, protagonist]");

    // The chip's bubbling wl-open-properties event opens the read-only popover.
    await chip.click();
    const popover = page.locator(".wl-props-popover");
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("characters/Aelindra.md");
    await expect(popover).toContainText("Aelindra, The Exile, Aelindra Vael");
    await page.getByRole("button", { name: "Close properties" }).click();
    await expect(popover).toHaveCount(0);
  });

  test("hides inline constructs: code, strong, underline, strikethrough", async ({
    page,
  }) => {
    await seedAndOpenScratch(page);
    const surface = editor(page);

    await expect(surface.locator(".wl-md-code")).toContainText("wardcode");
    await expect(surface.locator(".wl-md-strong")).toContainText("strong word");
    await expect(surface.locator(".wl-md-underline")).toContainText("undered");
    await expect(surface.locator(".wl-md-strike")).toContainText("struck");

    await expect(surface).not.toContainText("`");
    await expect(surface).not.toContainText("**");
    await expect(surface).not.toContainText("<u>");
    await expect(surface).not.toContainText("~~");
  });

  test("hides block constructs: quote markers, list markers, rule, fence, pipe link", async ({
    page,
  }) => {
    await seedAndOpenScratch(page);
    const surface = editor(page);

    // Heading hashes hidden, line styled; heading text readable.
    await expect(surface.locator(".wl-md-h1")).toContainText("Scratch heading");
    await expect(surface).not.toContainText("# Scratch heading");

    // Blockquote: two styled lines, no ">" anywhere.
    await expect(surface.locator(".wl-md-quote")).toHaveCount(2);
    await expect(surface).not.toContainText(">");

    // Lists: 2 bullet widgets + 2 raw ordered glyphs (4 dim markers total).
    await expect(surface.locator(".wl-md-bullet")).toHaveCount(4);
    await expect(surface).toContainText("• bullet alpha");
    await expect(surface).toContainText("1. ordered one");
    await expect(surface).toContainText("2. ordered two");

    // Horizontal rule collapses to an <hr>; the dashes are gone.
    await expect(surface.locator(".wl-md-hr")).toHaveCount(1);
    await expect(surface).not.toContainText("---");

    // Fenced code: three styled lines, no fence bytes visible.
    await expect(surface.locator(".wl-md-fenced")).toHaveCount(3);
    await expect(surface).toContainText("fence plain");
    await expect(surface).not.toContainText("```");

    // Pipe wikilink: display text only — target and brackets hidden.
    await expect(surface).toContainText("the city");
    await expect(surface).not.toContainText("|");
    await expect(surface).not.toContainText("Vael'Thor]]");
  });
});

/* ================================================================== */
/* W2 — Word toolbar                                                  */
/* ================================================================== */

test.describe("formatting toolbar", () => {
  test("exposes the frozen W2 control contract", async ({ page }) => {
    await openAelindra(page);
    const bar = page.getByRole("toolbar", { name: "Formatting" });
    await expect(bar).toBeVisible();

    await expect(styleSelect(page)).toBeVisible();
    await expect
      .poll(async () =>
        styleSelect(page).locator("option").allTextContents(),
      )
      .toEqual(["Normal", "Heading 1", "Heading 2", "Heading 3"]);

    for (const label of [
      "Bold",
      "Italic",
      "Strikethrough",
      "Underline",
      "Inline code",
      "Bulleted list",
      "Numbered list",
      "Quote",
      "Wikilink",
      "Indent",
      "Outdent",
    ]) {
      await expect(toggle(page, label)).toBeVisible();
    }
    await expect(bar.getByRole("button")).toHaveCount(11);
  });

  test("style dropdown reflects the caret's block", async ({ page }) => {
    await openAelindra(page);
    // Caret on the H1 line → dropdown shows Heading 1.
    await editor(page).locator(".wl-md-h1").click();
    await expect(styleSelect(page)).toHaveValue("h1");
    // Caret at the document end (plain paragraph) → Normal.
    await caretToEnd(page);
    await expect(styleSelect(page)).toHaveValue("normal");
  });

  test("inline toggle lights up inside a construct and goes dark outside", async ({
    page,
  }) => {
    await openAelindra(page);
    const bold = toggle(page, "Bold");
    await expect(bold).not.toHaveClass(/wl-md-btn-active/);

    // Double-click inside the bold span → caret in strong content.
    await editor(page).locator(".wl-md-strong").first().dblclick();
    await expect(bold).toHaveClass(/wl-md-btn-active/);

    // Back to plain text → dark again.
    await caretToEnd(page);
    await expect(bold).not.toHaveClass(/wl-md-btn-active/);
  });

  test("Bold button wraps the selection and stores **markdown**", async ({ page }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("wrapq");
    // HOME-KEY BUG workaround: Home/Shift+Home jump to line 0 instead of
    // the current line start (repro e2e diag DIAG-B2), smearing the
    // selection across the document — select with Shift+ArrowLefts instead.
    for (let i = 0; i < "wrapq".length; i++) {
      await page.keyboard.press("Shift+ArrowLeft");
    }

    await toggle(page, "Bold").click();

    // The scratch seed already carries a .wl-md-strong ("strong word") —
    // scope the new span by its text (strict-mode-safe).
    await expect(
      editor(page).locator(".wl-md-strong").filter({ hasText: "wrapq" }),
    ).toHaveCount(1);
    await expect(toggle(page, "Bold")).toHaveClass(/wl-md-btn-active/);
    await waitForDisk(page, SCRATCH, { includes: ["**wrapq**"] });
  });

  test("Strikethrough, Inline code and Underline buttons store their literal forms", async ({
    page,
  }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);

    await page.keyboard.press("Enter");
    await page.keyboard.type("alphaq");
    // HOME-KEY BUG workaround: Shift+Home jumps to line 0 (diag DIAG-B2) —
    // select each typed word with Shift+ArrowLefts instead.
    for (let i = 0; i < "alphaq".length; i++) {
      await page.keyboard.press("Shift+ArrowLeft");
    }
    await toggle(page, "Strikethrough").click();

    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("betaq");
    for (let i = 0; i < "betaq".length; i++) {
      await page.keyboard.press("Shift+ArrowLeft");
    }
    await toggle(page, "Inline code").click();

    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("gammaq");
    for (let i = 0; i < "gammaq".length; i++) {
      await page.keyboard.press("Shift+ArrowLeft");
    }
    await toggle(page, "Underline").click();

    // The scratch seed already contains struck/code/<u> spans, so each new
    // span is scoped by its own text (strict-mode-safe).
    const surface = editor(page);
    await expect(
      surface.locator(".wl-md-strike").filter({ hasText: "alphaq" }),
    ).toHaveCount(1);
    await expect(
      surface.locator(".wl-md-code").filter({ hasText: "betaq" }),
    ).toHaveCount(1);
    await expect(
      surface.locator(".wl-md-underline").filter({ hasText: "gammaq" }),
    ).toHaveCount(1);
    await expect(surface).not.toContainText("~~");
    await expect(surface).not.toContainText("`");
    await expect(surface).not.toContainText("<u>");

    await waitForDisk(page, SCRATCH, {
      includes: ["~~alphaq~~", "`betaq`", "<u>gammaq</u>"],
    });
  });

  test("style dropdown converts headings without stacking and Normal clears them", async ({
    page,
  }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("stylez");

    await styleSelect(page).selectOption("h1");
    // The scratch seed already has one .wl-md-h1 ("Scratch heading") —
    // scope the new heading by its text (strict-mode-safe).
    await expect(
      editor(page).locator(".wl-md-h1").filter({ hasText: "stylez" }),
    ).toHaveCount(1);
    await waitForDisk(page, SCRATCH, { lines: ["# stylez"] });

    // h1 → h2 converts the prefix instead of stacking a second marker.
    await styleSelect(page).selectOption("h2");
    await expect(styleSelect(page)).toHaveValue("h2");
    await waitForDisk(page, SCRATCH, { lines: ["## stylez"], excludes: ["# # stylez"] });

    await styleSelect(page).selectOption("normal");
    await expect(styleSelect(page)).toHaveValue("normal");
    await waitForDisk(page, SCRATCH, { lines: ["stylez"], excludes: ["# stylez"] });
  });

  test("Bulleted list and Numbered list toggle the line marker", async ({ page }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("itemz");

    await toggle(page, "Bulleted list").click();
    await expect(editor(page)).toContainText("• itemz");
    await waitForDisk(page, SCRATCH, { lines: ["- itemz"] });

    // A bullet line converts to ordered (no stacked second marker).
    await toggle(page, "Numbered list").click();
    await waitForDisk(page, SCRATCH, { lines: ["1. itemz"], excludes: ["- 1. itemz"] });

    // Toggling ordered off returns a plain paragraph.
    await toggle(page, "Numbered list").click();
    await waitForDisk(page, SCRATCH, { lines: ["itemz"], excludes: ["1. itemz"] });
  });

  test("Quote button toggles the '> ' prefix", async ({ page }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("quotez");

    await toggle(page, "Quote").click();
    await expect(editor(page).locator(".wl-md-quote")).toHaveCount(3); // 2 seeded + 1
    await waitForDisk(page, SCRATCH, { lines: ["> quotez"] });

    await toggle(page, "Quote").click();
    await waitForDisk(page, SCRATCH, { includes: ["\nquotez"], excludes: ["> quotez"] });
  });

  test("Indent and Outdent buttons move a list line by two spaces", async ({ page }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("itemq");
    await toggle(page, "Bulleted list").click();
    await waitForDisk(page, SCRATCH, { lines: ["- itemq"] });

    await toggle(page, "Indent").click();
    await waitForDisk(page, SCRATCH, { lines: ["  - itemq"] });

    await toggle(page, "Outdent").click();
    await waitForDisk(page, SCRATCH, { lines: ["- itemq"] });
  });

  test("Wikilink button inserts the [[|]] scaffold for a display alias", async ({
    page,
  }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("wq ");

    await toggle(page, "Wikilink").click();
    // applyWikilink (toolbar.ts, pinned by toolbar.test.ts) inserts "[[|]]"
    // with the caret AFTER the pipe (cursor from+3), so typed text lands in
    // the display-alias slot: the stored form is "[[|Aelindra]]".
    await page.keyboard.type("Aelindra");

    await expect(editor(page)).toContainText("Aelindra");
    await waitForDisk(page, SCRATCH, { includes: ["wq [[|Aelindra]]"] });
  });
});

/* ================================================================== */
/* W3 — behaviors keymap                                              */
/* ================================================================== */

test.describe("word behaviors", () => {
  test("Enter continues bullet lists and increments ordered lists", async ({ page }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");

    await page.keyboard.type("- alpha");
    await page.keyboard.press("Enter"); // continues with "- "
    await expect(editor(page)).toContainText("• alpha");
    await expect(editor(page)).toContainText("• ");
    await page.keyboard.type("beta");
    await page.keyboard.press("Enter"); // third, empty item
    await page.keyboard.press("Enter"); // empty item → exits the list

    await page.keyboard.type("1. one");
    await page.keyboard.press("Enter"); // ordered → "2. "
    await page.keyboard.type("two");

    await expect(editor(page)).toContainText("1. one");
    await expect(editor(page)).toContainText("2. two");
    await waitForDisk(page, SCRATCH, {
      lines: ["- alpha", "- beta", "1. one", "2. two"],
    });
  });

  test("Enter on an empty list item exits the list", async ({ page }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");

    await page.keyboard.type("- gamma");
    await page.keyboard.press("Enter"); // new empty "- "
    await page.keyboard.press("Enter"); // removes the prefix, leaves the list
    await page.keyboard.type("plainafterlist");

    await waitForDisk(page, SCRATCH, {
      includes: ["- gamma\nplainafterlist"],
      excludes: ["- plainafterlist"],
    });
  });

  test("Enter continues a blockquote", async ({ page }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");

    await page.keyboard.type("> quotezulu");
    await page.keyboard.press("Enter"); // continues with "> "
    await page.keyboard.type("secondzulu");

    await expect(editor(page).locator(".wl-md-quote")).toHaveCount(4); // 2 seeded + 2
    await waitForDisk(page, SCRATCH, { lines: ["> quotezulu", "> secondzulu"] });
  });

  test("Enter on a heading opens a plain paragraph", async ({ page }) => {
    await seedAndOpenScratch(page);
    await editor(page).locator(".wl-md-h1").click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("afterheading");

    // Not a heading continuation — a fresh paragraph right under the H1.
    await waitForDisk(page, SCRATCH, {
      includes: ["# Scratch heading\nafterheading"],
      excludes: ["# afterheading"],
    });
  });

  test("Tab indents a list line, Shift+Tab outdents, and plain text never bulletes", async ({
    page,
  }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("- tabme");
    await waitForDisk(page, SCRATCH, { lines: ["- tabme"] });

    await page.keyboard.press("Tab");
    await waitForDisk(page, SCRATCH, { lines: ["  - tabme"] });

    await page.keyboard.press("Shift+Tab");
    await waitForDisk(page, SCRATCH, { lines: ["- tabme"] });

    // Fall-through: Tab on a non-list line must not synthesize a list marker.
    await editor(page).locator(".wl-md-quote").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Tab");
    await expect(editor(page).locator(".wl-md-bullet")).toHaveCount(5); // unchanged (4 seeded + tabme)
  });

  test("Backspace at content start unwraps inline constructs", async ({ page }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");

    // **unwrapz**: 10 lefts put the caret between the opening markers and text.
    await page.keyboard.type("**unwrapz**");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");
    await expect(editor(page)).toContainText("unwrapz");
    await expect(editor(page)).not.toContainText("**unwrapz**");

    await page.keyboard.press("End");
    await page.keyboard.type(" `codewrapz`"); // backtick pair auto-closes
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Backspace");

    await waitForDisk(page, SCRATCH, {
      includes: ["unwrapz codewrapz"],
      excludes: ["**unwrapz**", "`codewrapz`"],
    });
  });

  test("Backspace at a heading's content start demotes h3 → h2 → h1 → paragraph", async ({
    page,
  }) => {
    await seedAndOpenScratch(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("demotez");
    await styleSelect(page).selectOption("h3");
    await waitForDisk(page, SCRATCH, { lines: ["### demotez"] });

    // HOME-KEY BUG workaround: Home jumps to line 0 instead of the current
    // line start (diag DIAG-B2), so reach the heading's content start with
    // ArrowLefts from the line end. Each demote leaves the caret at the
    // NEXT content start, so the Backspaces chain without re-navigating.
    for (let i = 0; i < "demotez".length; i++) await page.keyboard.press("ArrowLeft");

    // h3 → h2
    await page.keyboard.press("Backspace");
    await expect(editor(page).locator(".wl-md-h2")).toContainText("demotez");

    // h2 → h1
    await page.keyboard.press("Backspace");
    await expect(editor(page).locator(".wl-md-h1")).toHaveCount(2); // seeded + demotez

    // h1 → paragraph
    await page.keyboard.press("Backspace");
    await expect(editor(page).locator(".wl-md-h1")).toHaveCount(1); // seeded only
    await expect(editor(page)).toContainText("demotez");

    await waitForDisk(page, SCRATCH, {
      includes: ["demotez"],
      excludes: ["# demotez"],
    });
  });
});

/* ================================================================== */
/* Modes, persistence, autocomplete                                   */
/* ================================================================== */

test.describe("editor modes and persistence", () => {
  test("Ctrl+Shift+M toggles the raw source escape hatch and back", async ({ page }) => {
    await openAelindra(page);
    const surface = editor(page);

    // Live: no gutter, markers hidden, chip present.
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
    await expect(page.locator(".wl-frontmatter-chip")).toHaveCount(1);
    await expect(surface).not.toContainText("[[Vael'Thor]]");

    // Raw source: line numbers + every storage byte back.
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(1);
    await expect(surface).toContainText("---");
    await expect(surface).toContainText("aliases: [Aelindra, The Exile, Aelindra Vael]");
    await expect(surface).toContainText("# Aelindra");
    await expect(surface).toContainText("[[Vael'Thor]]");
    await expect(surface).toContainText("|"); // pipe link stored verbatim
    await expect(page.locator(".wl-frontmatter-chip")).toHaveCount(0);

    // …and back to live hiding.
    await page.keyboard.press("Control+Shift+M");
    await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
    await expect(page.locator(".wl-frontmatter-chip")).toHaveCount(1);
    await expect(surface).not.toContainText("[[Vael'Thor]]");
  });

  // Regression coverage for the WIKILINK-COMPLETION-UI bug (e2e diag DIAG-G8):
  // the CM6 autocomplete tooltip used to never open in the live editor — zero
  // .cm-tooltip elements after typing "[[" (closeBrackets renders "[[]]") and
  // after an explicit Ctrl+Space — even though the completion source and the
  // note index were both healthy (the source returned
  // {from:2,to:6,options:[Misthollow…]}; DIAG-F: index.all()=33,
  // byTitleOrAlias("Mist") resolves). Root cause: the source's replaced span
  // includes the literal "[[", and CM6's dialog fuzzy-matches every option
  // label against that raw span — no title contains "[", so every option was
  // discarded and the tooltip never opened. Fixed with `filter: false` on the
  // returned completion result (filtering/ranking is the lookup's job) plus
  // `completionKeymap` restored in LiveEditor.tsx for the Ctrl+Space trigger
  // and tooltip key handling.
  test("typing [[ opens the wikilink completion list and accepting inserts [[Title]]", async ({
    page,
  }) => {
    await openAelindra(page);
    await caretToEnd(page);
    await page.keyboard.press("Enter");

    await page.keyboard.type("[[");
    const tooltip = page.locator(".cm-tooltip-autocomplete");
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator("li")).toHaveCount(33); // every fixture note

    await page.keyboard.type("Mist"); // filters the list
    // MemoryIndex.byTitleOrAlias matches titles AND aliases with tiered
    // subsequence matching, so "Mist" legitimately matches 3 fixture notes:
    // Misthollow (tier 1 prefix) plus Mira and Session 01 (tier 2
    // subsequence). The tier-1 prefix match must rank FIRST.
    await expect(tooltip.locator("li")).toHaveCount(3);
    await expect(tooltip.locator("li").first()).toContainText("Misthollow");
    await tooltip.locator("li").filter({ hasText: "Misthollow" }).first().click();

    // Stored bytes contain the canonical [[Title]] form (Aelindra never
    // linked Misthollow before), the surface shows the title only.
    await waitForDisk(page, AELINDRA, { includes: ["[[Misthollow]]"] });
    await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  });

  test("status chip cycles saved → dirty → saved through the autosave seam", async ({
    page,
  }) => {
    await openAelindra(page);
    await expect(page.locator(".wl-chip")).toHaveText("saved");

    await caretToEnd(page);
    await page.keyboard.type(" CHIPTOKEN");
    await expect(page.locator(".wl-chip")).toHaveText("dirty");

    await waitForDisk(page, AELINDRA, { includes: ["CHIPTOKEN"] });
    await expect(page.locator(".wl-chip")).toHaveText("saved");
  });

  test("an external disk edit never clobbers unsaved local edits", async ({ page }) => {
    await openAelindra(page);
    await caretToEnd(page);
    await page.keyboard.type(" LOCALDIRTY");

    // External write + watcher echo arrives while the local edit is dirty.
    await page.evaluate(async (path) => {
      const w = window as unknown as HookedWindow;
      const original = await w.__e2e_fs_read(path);
      w.__e2e_fs_write(path, `${original}\n\nEXTERNAL-CLOBBER landed on disk.`);
      w.__e2e_watch_fire(path, "update");
    }, AELINDRA);

    // The watcher refresh runs (250ms debounce) but the dirty doc is kept.
    await expect(editor(page)).toContainText("LOCALDIRTY");
    await expect(editor(page)).not.toContainText("EXTERNAL-CLOBBER");

    // The local autosave then wins the write race.
    await waitForDisk(page, AELINDRA, {
      includes: ["LOCALDIRTY"],
      excludes: ["EXTERNAL-CLOBBER"],
    });
    await expect(editor(page)).toContainText("LOCALDIRTY");
  });
});

/* ================================================================== */
/* C1 — search palette                                                */
/* ================================================================== */

test.describe("search palette", () => {
  test("Ctrl+K opens the palette and a clicked hit opens its note", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Control+k");

    const palette = page.getByRole("dialog", { name: "Search" });
    await expect(palette).toBeVisible();
    const input = page.getByLabel("Search notes");
    await expect(input).toBeFocused();

    await input.fill("misthollow");
    const options = palette.getByRole("option");
    await expect(options.first().locator(".wl-palette-title")).toHaveText("Misthollow");
    // Pinned semantics (MemoryIndex.search): every query token must occur
    // in title+aliases+tags+BODY (AND over tokens), so "misthollow"
    // legitimately matches 7 notes — Misthollow ranks first via the
    // title-token + exact-phrase boosts.
    await expect(options).toHaveCount(7);

    await options.first().click();
    await expect(palette).toHaveCount(0);
    await expect(editor(page)).toContainText("fog-bound fishing village");
  });

  test("Arrow keys move the highlight, Enter opens, Escape closes", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Search" });
    const input = page.getByLabel("Search notes");

    await input.fill("session");
    // Pinned MemoryIndex.search semantics (body text counts): 22 notes
    // contain the token "session"; the six Session notes rank first.
    await expect(palette.getByRole("option")).toHaveCount(22);
    await expect(palette.locator(".wl-palette-hit-active")).toHaveCount(1);

    await page.keyboard.press("ArrowDown");
    await expect
      .poll(() =>
        palette
          .locator(".wl-palette-hit-active .wl-palette-title")
          .textContent(),
      )
      .not.toBeNull();
    const activeAfterMove = await palette
      .locator(".wl-palette-hit-active .wl-palette-title")
      .textContent();

    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    await expect(page.locator(".wl-empty")).toHaveText(
      "Select a note from the tree, or press Ctrl+K to search.",
    );

    // Reopen, land on a hit with Enter.
    await page.keyboard.press("Control+k");
    await input.fill("kestrel");
    await expect(palette.getByRole("option").first().locator(".wl-palette-title")).toHaveText(
      "Kestrel",
    );
    await page.keyboard.press("Enter");
    await expect(palette).toHaveCount(0);
    await expect(editor(page)).toContainText("Kestrel guides the");
    expect(activeAfterMove).toBeTruthy();
  });

  test("shows the empty state for a query with no hits", async ({ page }) => {
    await boot(page);
    await page.keyboard.press("Control+k");
    await page.getByLabel("Search notes").fill("zzzqqqnothere");
    await expect(page.getByRole("dialog", { name: "Search" })).toContainText(
      "No results.",
    );
  });
});

/* ================================================================== */
/* M2 — audit rail, findings, backlinks                               */
/* ================================================================== */

test.describe("audit rail and navigation", () => {
  test("offline audit surfaces exactly the seeded contradictions", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: "Audit", exact: true }).click();

    const findings = page.locator('section[aria-label="Findings"]');
    await expect(findings).toBeVisible();
    await findings.getByRole("button", { name: "Run audit" }).click();

    // 1 duplicate alias + 2 missing relation targets + 1 temporal overlap
    // + 6 dead wikilinks (pinned by src/core/audit/rules.test.ts).
    await expect(findings.locator(".wl-findings-header .wl-count")).toHaveText("10");
    await expect(findings.getByText("duplicate alias", { exact: true })).toHaveCount(1);
    await expect(findings.getByText("missing relation target", { exact: true })).toHaveCount(2);
    await expect(findings.getByText("temporal overlap", { exact: true })).toHaveCount(1);
    await expect(findings.getByText("dead wikilink", { exact: true })).toHaveCount(6);
    // 12 quote cards: 2-sided for dup-alias + temporal, 1-sided otherwise.
    await expect(findings.locator(".wl-quote")).toHaveCount(12);
    await expect(findings).toContainText('alias "The Ashen Crown"');
    // Unconfigured AI degrades to a note; the rules pass still works.
    await expect(findings).toContainText("rules pass still works");
    await expect(findings.getByRole("button", { name: "Re-audit" })).toBeVisible();
  });

  test("dismissing a finding hides it and the tombstone survives a re-audit", async ({
    page,
  }) => {
    await boot(page);
    await page.getByRole("button", { name: "Audit", exact: true }).click();
    const findings = page.locator('section[aria-label="Findings"]');
    await findings.getByRole("button", { name: "Run audit" }).click();
    await expect(findings.locator(".wl-findings-header .wl-count")).toHaveText("10");

    await findings.getByRole("button", { name: "Dismiss" }).first().click();
    await expect(findings.locator(".wl-findings-header .wl-count")).toHaveText("9");

    // Tombstone lives in the audit-state store port — a re-audit keeps it gone.
    await findings.getByRole("button", { name: "Re-audit" }).click();
    await expect(findings.locator(".wl-findings-header .wl-count")).toHaveText("9");
  });

  test("clicking a finding quote opens the note and reveals the quoted line", async ({
    page,
  }) => {
    await boot(page);
    await page.getByRole("button", { name: "Audit", exact: true }).click();
    const findings = page.locator('section[aria-label="Findings"]');
    await findings.getByRole("button", { name: "Run audit" }).click();

    // The dead link [[Order of the Pale Hand]] inside characters/Aelindra.md.
    const quote = findings.locator('.wl-quote[title^="characters/Aelindra.md"]', {
      hasText: "Order of the Pale Hand",
    });
    await expect(quote).toHaveCount(1);
    await quote.click();

    await expect(editor(page)).toContainText("grey-green");
    // The reveal puts the caret on the quoted line (0-based line in title).
    await expect.poll(() => caretLineText(page)).toContain("Order of the Pale Hand");
  });

  test("backlinks panel lists incoming links and navigates to the source line", async ({
    page,
  }) => {
    await openAelindra(page);
    const backlinks = page.locator('section[aria-label="Backlinks"]');
    await expect(backlinks).toBeVisible();
    await expect(backlinks.locator(".wl-backlink-item")).not.toHaveCount(0);

    // Kestrel's [[Aelindra]] link — BacklinksPanel renders each row AS a
    // <button class="wl-backlink-item"> directly after the source div, so
    // the adjacent-sibling button itself is the click target (nesting
    // getByRole("button") inside a <button> never resolves).
    const kestrelItem = backlinks.locator(
      '.wl-backlink-source[title="characters/Kestrel.md"] + button.wl-backlink-item',
    );
    await expect(kestrelItem).toHaveCount(1);
    await kestrelItem.click();

    await expect(editor(page)).toContainText("Kestrel guides the");
    await expect.poll(() => caretLineText(page)).toContain("met Aelindra on the");
  });
});
