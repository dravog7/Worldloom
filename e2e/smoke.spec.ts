/**
 * Wave E1 smoke spec: boots the real app (vite dev) against the mocked
 * Tauri bridge and exercises the boot → tree → open → edit → autosave →
 * watcher-refresh loop plus the AI command seam. Selector intent was checked
 * against src/App.tsx, src/panels/FileTree.tsx and src/editor (roles and
 * aria-labels), but every assertion here was proven against a live run.
 */
import { test, expect } from "@playwright/test";
import { initTauriMock, VAULT_ROOT } from "./harness";

const AELINDRA = `${VAULT_ROOT}/characters/Aelindra.md`;

test.beforeEach(async ({ page }) => {
  await initTauriMock(page);
});

test("boots into the fixture vault and shows the tree", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".wl-title")).toHaveText("e2e-vault");
  const tree = page.getByRole("tree", { name: "Vault files" });
  await expect(tree).toBeVisible();
  // Root level = the fixture vault's eight category folders.
  await expect(tree.getByRole("treeitem")).toHaveCount(8);
  await expect(page.getByText("Opening vault…")).toHaveCount(0);
});

test("opens a note from the tree into the editor", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Vault files" });
  await tree.getByRole("treeitem", { name: "characters" }).click();
  await tree.getByRole("treeitem", { name: "Aelindra" }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toBeVisible();
  await expect(editor).toContainText("Aelindra Vael");
});

test("adopts an external disk edit fired through the fs watcher", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Vault files" });
  await tree.getByRole("treeitem", { name: "characters" }).click();
  await tree.getByRole("treeitem", { name: "Aelindra" }).click();
  await expect(page.locator(".cm-content")).toContainText("Aelindra Vael");

  await page.evaluate(async (path) => {
    const original = await window.__e2e_fs_read(path);
    window.__e2e_fs_write(path, `${original}\n\nEXTERNAL-EDIT-MARKER landed on disk.`);
    window.__e2e_watch_fire(path, "update");
  }, AELINDRA);
  await expect(page.locator(".cm-content")).toContainText("EXTERNAL-EDIT-MARKER");
});

test("autosave writes edits through the atomic tmp+rename seam", async ({ page }) => {
  await page.goto("/");
  const tree = page.getByRole("tree", { name: "Vault files" });
  await tree.getByRole("treeitem", { name: "characters" }).click();
  await tree.getByRole("treeitem", { name: "Aelindra" }).click();
  await expect(page.locator(".cm-content")).toContainText("Aelindra Vael");

  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" SMOKE-TYPED-SENTINEL");

  // 800ms autosave debounce + atomic write (tmp file + rename over target).
  await page.waitForFunction(
    (path) => window.__e2e_fs_read(path).then((c) => c.includes("SMOKE-TYPED-SENTINEL")),
    AELINDRA,
  );
  await expect(page.locator(".wl-chip")).toHaveText("saved");
  // No stray .tmp sibling survives the atomic save.
  await expect
    .poll(() => page.evaluate((p) => window.__e2e_fs_read(`${p}.tmp`).catch(() => "gone"), AELINDRA))
    .toBe("gone");
});

test("AI command seam answers with the seeded key status and canned reply", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".wl-title")).toHaveText("e2e-vault");
  const seam = await page.evaluate(async () => {
    const keyPresent = await window.__TAURI_INTERNALS__.invoke("key_get_status");
    const reply = await window.__TAURI_INTERNALS__.invoke("ai_chat", {
      request: { baseUrl: "http://localhost", model: "smoke", messages: [], max_tokens: 8 },
    });
    const unknown = window.__e2e_unknown_commands.slice();
    return { keyPresent, content: reply.content, latencyMs: reply.latency_ms, unknown };
  });
  expect(seam.keyPresent).toBe(false);
  expect(seam.content).toBe("ok");
  expect(seam.latencyMs).toBe(1);
  expect(seam.unknown).toEqual([]);
});
