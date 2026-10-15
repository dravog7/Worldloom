/**
 * M2.5 I3 — the API key never enters renderer state.
 *
 * `saveAiKey` must forward the key straight to the keyring adapter and keep
 * only the presence flag: after any save (success or failure) the secret
 * must not survive anywhere in the zustand store, and error surfacing must
 * not echo the key.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-fs", () => ({
  watch: vi.fn(async () => () => {}),
  exists: vi.fn(async () => false),
  mkdir: vi.fn(async () => undefined),
  readDir: vi.fn(async () => []),
  readTextFile: vi.fn(async () => ""),
  remove: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
  writeTextFile: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(async () => false),
  open: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
      save: vi.fn(async () => undefined),
    })),
  },
}));

vi.mock("./adapters/ai-key", () => ({
  setAiKey: vi.fn(async () => undefined),
  getAiKeyStatus: vi.fn(async () => true),
  chatViaProxy: vi.fn(async () => ({ content: "ok", latencyMs: 1 })),
  keyringErrorMessage: (e: unknown) => String(e),
}));

import { useStore } from "./store";
import { getAiKeyStatus, setAiKey } from "./adapters/ai-key";

/** Canary secret — any trace in store state or results fails a test. */
const SECRET = "sk-store-leak-canary-99";

describe("store — API key stays out of renderer state (M2.5 I3)", () => {
  it("saveAiKey forwards to the keyring and retains only the presence flag", async () => {
    const result = await useStore.getState().saveAiKey(SECRET);
    expect(result).toEqual({ ok: true });
    expect(vi.mocked(setAiKey)).toHaveBeenCalledWith(SECRET);
    expect(vi.mocked(getAiKeyStatus)).toHaveBeenCalled();
    expect(useStore.getState().aiKeyPresent).toBe(true);
    expect(JSON.stringify(useStore.getState())).not.toContain(SECRET);
  });

  it("surfaces keyring failures without echoing the key anywhere", async () => {
    vi.mocked(setAiKey).mockRejectedValueOnce(new Error("keyring storage error: boom"));
    const result = await useStore.getState().saveAiKey(SECRET);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(useStore.getState())).not.toContain(SECRET);
  });
});
