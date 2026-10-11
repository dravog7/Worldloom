/**
 * I1 store — the single wiring layer between Tauri adapters, the core vault
 * stack (VaultService + MemoryIndex + parser) and the Wave-C components.
 * This is the only module allowed to import @tauri-apps/* besides adapters.
 */
import { create } from "zustand";
import { watch, type WatchEvent } from "@tauri-apps/plugin-fs";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import { MemoryIndex } from "../core/index/memory-index";
import { parseNote } from "../core/parser";
import {
  VaultService,
  generateStubNote,
  slugifyFileName,
  systemTimer,
} from "../core/vault";
import type { LinkRef, SearchHit } from "../core/types";
import {
  groupBacklinks,
  initialSearchState,
  searchReducer,
  type BacklinkGroup,
  type SearchAction,
  type SearchState,
  type TreeNode,
} from "../panels";
import { TauriFsAdapter } from "./adapters/tauri-fs";
import { pickVaultFolder } from "./adapters/folder-dialog";
import { loadVaultPath, saveVaultPath } from "./adapters/vault-path";

const fs = new TauriFsAdapter();

export type AppStatus = "boot" | "no-vault" | "loading" | "ready" | "error";
export type EditorStatus = "saved" | "saving" | "dirty";
/** Editor layout (ADR-005): live preview is the default; source is opt-in. */
export type EditorLayout = "live" | "split" | "source";

interface StoreState {
  status: AppStatus;
  errorMessage?: string;
  vaultRoot: string | null;
  vaultName: string;
  tree: TreeNode[];
  treeFilter: string;
  expanded: ReadonlySet<string>;
  currentPath: string | null;
  currentContent: string;
  editorStatus: EditorStatus;
  backlinks: BacklinkGroup[];
  search: SearchState;
  layout: EditorLayout;

  boot(): Promise<void>;
  openVaultDialog(): Promise<void>;
  openNote(path: string): Promise<void>;
  saveNote(path: string, content: string): Promise<void>;
  navigateWikilink(target: string): Promise<void>;
  createNote(parentPath: string): Promise<void>;
  deleteNote(path: string): Promise<void>;
  renameNote(path: string): Promise<void>;
  setTreeFilter(filter: string): void;
  toggleExpanded(path: string): void;
  dispatchSearch(action: SearchAction): void;
  querySearch(query: string): void;
  setLayout(layout: EditorLayout): void;
}

let vault: VaultService | null = null;
let index: MemoryIndex | null = null;
let unlisten: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Same app-data settings file as the vault-path adapter (B3). */
const SETTINGS_FILE = "worldloom-settings.json";

const abs = (root: string, rel: string): string =>
  `${root.replace(/[\\/]+$/, "")}/${rel}`;
const toRel = (root: string, path: string): string =>
  path.replace(/\\/g, "/").slice(root.replace(/\\/g, "/").length + 1);

/** Build a FileTree tree (dirs + files) from vault-relative note paths. */
function buildTree(paths: string[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();
  const ensureDir = (dirPath: string): TreeNode[] => {
    if (dirPath === "") return roots;
    const existing = dirMap.get(dirPath);
    if (existing) return existing.children ?? (existing.children = []);
    const name = dirPath.slice(dirPath.lastIndexOf("/") + 1);
    const node: TreeNode = { name, path: dirPath, isDirectory: true, children: [] };
    dirMap.set(dirPath, node);
    ensureDir(dirPath.includes("/") ? dirPath.slice(0, dirPath.lastIndexOf("/")) : "").push(node);
    return node.children ?? (node.children = []);
  };
  for (const path of [...paths].sort()) {
    const slash = path.lastIndexOf("/");
    if (slash === -1) {
      roots.push({ name: path, path, isDirectory: false });
    } else {
      ensureDir(path.slice(0, slash)).push({ name: path.slice(slash + 1), path, isDirectory: false });
    }
  }
  return roots;
}

const changeKind = (kind: WatchEvent["type"]): "create" | "update" | "delete" | null => {
  if (typeof kind !== "object" || kind === null) return null;
  if ("create" in kind) return "create";
  if ("modify" in kind) return "update";
  if ("remove" in kind) return "delete";
  return null;
};

export const useStore = create<StoreState>()((set, get) => {
  /** After watcher events settle: flush the vault debounce, then refresh derived UI state. */
  async function refreshDerived(): Promise<void> {
    if (!vault || !index) return;
    await vault.flushPending();
    const root = get().vaultRoot;
    set({ tree: buildTree(index.all().map((n) => n.path)) });
    const current = get().currentPath;
    if (root && current) {
      set({ backlinks: groupBacklinks(index.backlinks(current)) as BacklinkGroup[] });
      // Adopt external edits (EditorPane ignores this while there are unsaved local changes).
      try {
        const content = await fs.readText(abs(root, current));
        if (content !== get().currentContent) set({ currentContent: content });
      } catch {
        /* note vanished — tree refresh handles it */
      }
    }
  }

  async function openVaultRoot(root: string): Promise<void> {
    set({ status: "loading", vaultRoot: root, currentPath: null, currentContent: "", backlinks: [] });
    try {
      if (unlisten) { await unlisten(); unlisten = null; }
      index = new MemoryIndex();
      vault = new VaultService({ fs, parseNote, index, timer: systemTimer });
      await vault.buildIndex(root);
      await saveVaultPath(root);
      set({
        status: "ready",
        vaultName: root.slice(root.replace(/\\/g, "/").lastIndexOf("/") + 1),
        tree: buildTree(index.all().map((n) => n.path)),
      });
      unlisten = await watch(root, (event: WatchEvent) => {
        if (!vault) return;
        const kind = changeKind(event.type);
        if (!kind) return;
        for (const eventPath of event.paths) {
          const rel = toRel(root, eventPath);
          if (rel.endsWith(".tmp") || rel === "") continue;
          vault.applyChange(rel, kind);
        }
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void refreshDerived(), 250);
      }, { recursive: true, delayMs: 150 });
    } catch (error) {
      set({ status: "error", errorMessage: String(error) });
    }
  }

  return {
    status: "boot",
    vaultRoot: null,
    vaultName: "",
    tree: [],
    treeFilter: "",
    expanded: new Set<string>(),
    currentPath: null,
    currentContent: "",
    editorStatus: "saved",
    backlinks: [],
    search: initialSearchState,
    layout: "live",

    async boot() {
      try {
        const settings = await Store.load(SETTINGS_FILE);
        const savedLayout = await settings.get<string>("layout");
        if (savedLayout === "live" || savedLayout === "split" || savedLayout === "source") {
          set({ layout: savedLayout });
        }
      } catch {
        /* plain vite dev / store unavailable — default split */
      }
      try {
        const saved = await loadVaultPath();
        if (saved && (await fs.exists(saved))) {
          await openVaultRoot(saved);
        } else {
          set({ status: "no-vault" });
        }
      } catch {
        // Running outside Tauri (plain vite dev) or store unavailable.
        set({ status: "no-vault" });
      }
    },

    async openVaultDialog() {
      const folder = await pickVaultFolder();
      if (folder) await openVaultRoot(folder);
    },

    async openNote(path) {
      const root = get().vaultRoot;
      if (!root || !index) return;
      try {
        const content = await fs.readText(abs(root, path));
        set({
          currentPath: path,
          currentContent: content,
          editorStatus: "saved",
          backlinks: groupBacklinks(index.backlinks(path)) as BacklinkGroup[],
        });
      } catch (error) {
        set({ errorMessage: String(error) });
      }
    },

    async saveNote(path, content) {
      if (!vault || !index) return;
      set({ editorStatus: "saving" });
      try {
        await vault.saveNote(path, content);
        set({ editorStatus: "saved", backlinks: groupBacklinks(index.backlinks(path)) as BacklinkGroup[] });
      } catch (error) {
        set({ editorStatus: "dirty", errorMessage: String(error) });
      }
    },

    async navigateWikilink(target) {
      if (!index || !vault || !get().vaultRoot) return;
      const hit = index.byTitleOrAlias(target)[0];
      if (hit) {
        await get().openNote(hit.path);
        return;
      }
      // Unresolved link → create a stub note and open it (PLAN-M1 C1/C3 flow).
      const created = await vault.createStub(get().vaultRoot as string, target);
      set({ tree: buildTree(index.all().map((n) => n.path)) });
      await get().openNote(created);
    },

    async createNote(parentPath) {
      const root = get().vaultRoot;
      if (!root || !vault || !index) return;
      const existing = new Set(index.all().map((n) => n.path));
      let n = 0;
      let title = "Untitled Note";
      let rel = parentPath ? `${parentPath}/${slugifyFileName(title)}.md` : `${slugifyFileName(title)}.md`;
      while (existing.has(rel)) {
        n += 1;
        title = `Untitled Note ${n + 1}`;
        rel = parentPath ? `${parentPath}/${slugifyFileName(title)}.md` : `${slugifyFileName(title)}.md`;
      }
      await fs.writeText(abs(root, rel), generateStubNote(title));
      vault.applyChange(rel, "create");
      set({ tree: buildTree(index.all().map((x) => x.path)) });
      await get().openNote(rel);
    },

    async deleteNote(path) {
      const root = get().vaultRoot;
      if (!root || !vault || !index) return;
      const ok = await confirm(`Delete ${path}? This removes the file from disk.`, {
        title: "Delete note",
        kind: "warning",
      });
      if (!ok) return;
      await fs.remove(abs(root, path));
      vault.applyChange(path, "delete");
      if (get().currentPath === path) set({ currentPath: null, currentContent: "", backlinks: [] });
      set({ tree: buildTree(index.all().map((n) => n.path)) });
    },

    // M1 known gap: Tauri dialog has no text-input prompt; rename UI arrives in M1.1.
    async renameNote(path) {
      console.warn(`rename deferred (M1 gap): ${path}`);
    },

    setTreeFilter(treeFilter) {
      set({ treeFilter });
    },

    toggleExpanded(path) {
      const next = new Set(get().expanded);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      set({ expanded: next });
    },

    dispatchSearch(action) {
      set({ search: searchReducer(get().search, action) });
    },

    querySearch(query) {
      const hits: SearchHit[] = index && query.trim() ? index.search(query) : [];
      set({ search: searchReducer({ ...get().search, query, hits }, { type: "setHits", hits }) });
    },

    setLayout(layout) {
      set({ layout });
      void Store.load(SETTINGS_FILE)
        .then(async (settings) => {
          await settings.set("layout", layout);
          await settings.save();
        })
        .catch(() => {
          /* persistence is best-effort */
        });
    },
  };
});

/** Convenience selector for wikilink autocomplete: empty query lists everything. */
export function lookupCandidates(query: string): { title: string; path: string; aliases: string[] }[] {
  if (!index) return [];
  return query.trim() ? index.byTitleOrAlias(query) : index.all();
}

export type { LinkRef };
