/**
 * Tauri-bridge mock for Playwright e2e (Wave E1) — plain JS on purpose: it is
 * injected verbatim via page.addInitScript() before any app script runs, so
 * no build/transpile step may touch it.
 *
 * Implements the exact slice of `window.__TAURI_INTERNALS__` that
 * @tauri-apps/api consumes (invoke / transformCallback / unregisterCallback /
 * convertFileSrc) plus every plugin command the app reaches during boot, note
 * editing and the AI seam. Command names and argument shapes below were read
 * from the installed dist-js of @tauri-apps/plugin-{fs,store,dialog} — do not
 * "simplify" them against memory:
 *   plugin:fs|read_text_file {path}                      -> byte array (NOT string)
 *   plugin:fs|write_text_file (args=Uint8Array, options.headers.path)
 *   plugin:fs|rename {oldPath, newPath}                  -> overwrite allowed
 *   plugin:fs|watch {paths, options, onEvent}            -> onEvent.id = Channel cb id
 *   plugin:store|get {rid,key}                           -> [value, exists]
 *
 * Backing store: the fixture vault at cfg.fixturePrefix (served by Vite)
 * overlaid with an in-memory copy-on-write layer, so tests can write without
 * touching the repo.
 *
 * Test hooks (window.*):
 *   __e2e_watch_fire(absPath, 'create'|'update'|'remove') — deliver a WatchEvent
 *   __e2e_fs_write(absPath, content)                      — overlay write, no event
 *   __e2e_fs_read(absPath)                                — logical content promise
 *   __e2e_unknown_commands / __e2e_invocations            — diagnostics
 */
(() => {
  const cfg = window.__E2E_CONFIG__ || {};
  const ROOT = String(cfg.vaultRoot || "/e2e-vault");
  const FIXTURE_PREFIX = String(cfg.fixturePrefix || "/fixtures/vault-sample");
  const manifestDirs = new Set(cfg.dirs || []);
  const manifestFiles = new Set(cfg.files || []);

  // ---- callback registry (Channel plumbing) -----------------------------
  const callbacks = new Map();
  let nextCallbackId = 1;
  const transformCallback = (cb, once) => {
    const id = nextCallbackId++;
    callbacks.set(id, once ? (...a) => { callbacks.delete(id); cb(...a); } : cb);
    return id;
  };

  // ---- overlay fs (copy-on-write on top of the fixture vault) ------------
  const overlayFiles = new Map(); // abs path -> string content, or null (tombstone)
  const overlayDirs = new Set(); // abs path -> created dirs
  const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const isVault = (p) => {
    const n = norm(p);
    return n === ROOT || n.startsWith(ROOT + "/");
  };
  const relOf = (p) => norm(p).slice(ROOT.length + 1);
  const fetchFixture = async (rel) => {
    const res = await fetch(`${FIXTURE_PREFIX}/${rel}`);
    if (!res.ok) throw new Error(`ENOENT: ${rel} (fixture HTTP ${res.status})`);
    return res.text();
  };

  const exists = (p) => {
    const n = norm(p);
    if (n === ROOT || n === "/") return true;
    if (overlayFiles.has(n)) return overlayFiles.get(n) !== null;
    if (overlayDirs.has(n)) return true;
    if (!isVault(n)) return false;
    const rel = relOf(n);
    return manifestDirs.has(rel) || manifestFiles.has(rel);
  };

  const readText = async (p) => {
    const n = norm(p);
    if (overlayFiles.has(n)) {
      const v = overlayFiles.get(n);
      if (v === null) throw new Error(`ENOENT: ${n}`);
      return v;
    }
    if (!isVault(n) || !manifestFiles.has(relOf(n))) throw new Error(`ENOENT: ${n}`);
    return fetchFixture(relOf(n));
  };

  const listDir = (p) => {
    const n = norm(p);
    if (!exists(n)) throw new Error(`ENOENT: ${n}`);
    const prefix = n === ROOT ? "" : relOf(n) + "/";
    const children = new Map(); // name -> {name, isDirectory, path}
    const add = (rel, isDirectory) => {
      if (!rel.startsWith(prefix)) return;
      const rest = rel.slice(prefix.length);
      if (!rest) return;
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (name.endsWith(".tmp")) return;
      const childPath = n === ROOT ? `${ROOT}/${name}` : `${n}/${name}`;
      children.set(name, { name, isDirectory: slash === -1 ? isDirectory : true, path: childPath });
    };
    for (const rel of manifestDirs) add(rel, true);
    for (const rel of manifestFiles) add(rel, false);
    for (const abs of overlayDirs) add(relOf(abs), true);
    for (const [abs, value] of overlayFiles) if (value !== null) add(relOf(abs), false);
    // Overlay tombstones shadow manifest entries.
    for (const [abs, value] of overlayFiles) {
      if (value !== null) continue;
      const rel = relOf(abs);
      if (!rel.startsWith(prefix)) continue;
      const rest = rel.slice(prefix.length);
      if (rest.includes("/")) continue; // tombstoned file hides its own name only
      children.delete(rest);
    }
    return [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  // ---- plugin-store: per-file key/value stores, localStorage-backed ------
  const stores = new Map(); // rid -> {name, data: Map}
  let nextRid = 1;
  const storeFile = (name) => {
    if (stores.has(name)) return stores.get(name);
    let data = {};
    try {
      const saved = localStorage.getItem(`e2e-store:${name}`);
      if (saved) data = JSON.parse(saved);
    } catch { /* fresh session */ }
    const seeded = { ...(cfg.seedStore && cfg.seedStore[name] ? cfg.seedStore[name] : {}), ...data };
    const file = { name, data: new Map(Object.entries(seeded)) };
    stores.set(name, file);
    return file;
  };
  const persistStore = (file) => {
    try {
      localStorage.setItem(`e2e-store:${file.name}`, JSON.stringify(Object.fromEntries(file.data)));
    } catch { /* storage disabled — in-memory only */ }
  };

  // ---- watchers: watch root -> Channel callback id ------------------------
  const watchers = new Map(); // rid -> {channelId, paths}
  let channelSeq = 0;

  // ---- command table ------------------------------------------------------
  const unknownCommands = [];
  const invocations = [];
  const commands = {
    // plugin-store ---------------------------------------------------------
    "plugin:store|load": (args) => {
      const file = storeFile(String(args.path));
      const rid = `store:${nextRid++}`;
      stores.set(rid, file);
      return rid;
    },
    "plugin:store|get": (args) => {
      const file = stores.get(args.rid);
      if (!file) return [null, false];
      return file.data.has(args.key) ? [file.data.get(args.key), true] : [null, false];
    },
    "plugin:store|set": (args) => {
      const file = stores.get(args.rid);
      if (file) file.data.set(args.key, args.value);
      return null;
    },
    "plugin:store|save": (args) => {
      const file = stores.get(args.rid);
      if (file) persistStore(file);
      return null;
    },
    // plugin-fs ------------------------------------------------------------
    "plugin:fs|read_dir": (args) => listDir(args.path),
    "plugin:fs|read_text_file": async (args) => {
      const text = await readText(args.path);
      return Array.from(new TextEncoder().encode(text));
    },
    "plugin:fs|write_text_file": (args, options) => {
      const header = options && options.headers && options.headers.path;
      if (typeof header !== "string") throw new Error("write_text_file: missing path header");
      const path = norm(decodeURIComponent(header));
      overlayFiles.set(path, new TextDecoder().decode(args));
      return null;
    },
    "plugin:fs|exists": (args) => exists(args.path),
    "plugin:fs|mkdir": (args) => {
      overlayDirs.add(norm(args.path));
      return null;
    },
    "plugin:fs|rename": async (args) => {
      const from = norm(args.oldPath);
      const to = norm(args.newPath);
      let value;
      if (overlayFiles.has(from)) value = overlayFiles.get(from);
      else value = await readText(from); // fixture-backed source
      overlayFiles.delete(from);
      overlayFiles.set(to, value); // rename replaces an existing target
      return null;
    },
    "plugin:fs|remove": (args) => {
      overlayFiles.set(norm(args.path), null);
      return null;
    },
    "plugin:fs|watch": (args) => {
      const rid = `watch:${nextRid++}`;
      const channelId = args.onEvent && args.onEvent.id;
      watchers.set(rid, { channelId, paths: (args.paths || []).map(norm) });
      return rid;
    },
    "plugin:resources|close": (args) => {
      watchers.delete(args.rid);
      return null;
    },
    // plugin-dialog --------------------------------------------------------
    "plugin:dialog|open": () => ROOT,
    "plugin:dialog|message": () => true,
    "plugin:dialog|confirm": () => true,
    // app commands (src-tauri/src/ai_key.rs, ai_chat.rs) -------------------
    key_get_status: () => false,
    key_set: () => null,
    key_delete: () => null,
    ai_chat: () => ({ content: "ok", latency_ms: 1 }),
  };

  const invoke = async (cmd, args = {}, options = {}) => {
    invocations.push(cmd);
    const handler = commands[cmd];
    if (!handler) {
      unknownCommands.push(cmd);
      return null;
    }
    return handler(args, options);
  };

  // ---- window.__TAURI_INTERNALS__ ----------------------------------------
  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback: (id) => { callbacks.delete(id); },
    convertFileSrc: (p) => p,
  };

  // ---- test hooks ---------------------------------------------------------
  window.__e2e_unknown_commands = unknownCommands;
  window.__e2e_invocations = invocations;
  window.__e2e_watch_fire = (absPath, kind) => {
    const path = norm(absPath);
    const type =
      kind === "create" ? { create: null } :
      kind === "remove" ? { remove: null } :
      { modify: { kind: "Any" } };
    const event = { paths: [path], type };
    for (const { channelId, paths } of watchers.values()) {
      if (!paths.some((watched) => path === watched || path.startsWith(watched + "/"))) continue;
      const cb = callbacks.get(channelId);
      if (cb) cb({ index: channelSeq++, message: event });
    }
  };
  window.__e2e_fs_write = (absPath, content) => { overlayFiles.set(norm(absPath), String(content)); };
  window.__e2e_fs_read = (absPath) => readText(absPath);
})();
