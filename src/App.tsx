import { useEffect } from "react";
import "./App.css";
import { EditorPane } from "./editor";
import { PreviewPane, PreviewToolbar } from "./preview";
import { BacklinksPanel, FileTree, SearchPalette, select } from "./panels";
import { lookupCandidates, useStore } from "./app/store";

/**
 * I1 wiring: header + sidebar (tree, backlinks) + editor/preview split +
 * Ctrl+K search palette, all driven by the zustand store. Wave A shell
 * replaced; components stay prop-injected per ARCH.md.
 */
function App() {
  const status = useStore((s) => s.status);
  const errorMessage = useStore((s) => s.errorMessage);
  const vaultName = useStore((s) => s.vaultName);
  const tree = useStore((s) => s.tree);
  const treeFilter = useStore((s) => s.treeFilter);
  const expanded = useStore((s) => s.expanded);
  const currentPath = useStore((s) => s.currentPath);
  const currentContent = useStore((s) => s.currentContent);
  const editorStatus = useStore((s) => s.editorStatus);
  const backlinks = useStore((s) => s.backlinks);
  const search = useStore((s) => s.search);
  const layout = useStore((s) => s.layout);
  const store = useStore.getState;

  useEffect(() => {
    void useStore.getState().boot();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        useStore.getState().dispatchSearch({ type: "open" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (status === "boot" || status === "loading") {
    return <main className="wl-center"><p className="muted">Opening vault…</p></main>;
  }

  if (status === "no-vault" || status === "error") {
    return (
      <main className="wl-center">
        <h1>Worldloom</h1>
        <p className="muted">
          {status === "error"
            ? `Could not open vault: ${errorMessage ?? "unknown error"}`
            : "Open a folder of markdown files to begin your worldbase."}
        </p>
        <button className="wl-btn" onClick={() => void store().openVaultDialog()}>
          Open vault folder
        </button>
      </main>
    );
  }

  const showEditor = layout !== "preview-only";
  const showPreview = layout !== "editor-only";

  return (
    <div className="wl-app">
      <header className="wl-header">
        <span className="wl-title">{vaultName}</span>
        <span className={`wl-chip wl-chip-${editorStatus}`}>{editorStatus}</span>
        <PreviewToolbar current={layout} onLayoutChange={(mode) => store().setLayout(mode)} />
        <button className="wl-btn wl-btn-ghost" onClick={() => store().dispatchSearch({ type: "open" })}>
          Search ⌘K
        </button>
        <button className="wl-btn wl-btn-ghost" onClick={() => void store().openVaultDialog()}>
          Switch vault
        </button>
      </header>

      <aside className="wl-sidebar">
        <input
          className="wl-filter"
          placeholder="Filter notes…"
          value={treeFilter}
          onChange={(e) => store().setTreeFilter(e.target.value)}
        />
        <FileTree
          tree={tree}
          expanded={expanded}
          filter={treeFilter}
          onOpen={(p) => void store().openNote(p)}
          onToggle={(p) => store().toggleExpanded(p)}
          onCreate={(parent) => void store().createNote(parent)}
          onRename={(p) => void store().renameNote(p)}
          onDelete={(p) => void store().deleteNote(p)}
        />
        {currentPath && <BacklinksPanel groups={backlinks} onOpen={(p) => void store().openNote(p)} />}
      </aside>

      <section className={`wl-main wl-layout-${layout}`}>
        <div className="wl-panes">
          {showEditor && currentPath && (
            <EditorPane
              path={currentPath}
              content={currentContent}
              lookup={lookupCandidates}
              onSave={(p, c) => void store().saveNote(p, c)}
              onStatusChange={(s) => useStore.setState({ editorStatus: s })}
            />
          )}
          {showEditor && !currentPath && (
            <p className="wl-empty muted">Select a note from the tree, or press Ctrl+K to search.</p>
          )}
          {showPreview && currentPath && (
            <PreviewPane markdown={currentContent} onNavigate={(t) => void store().navigateWikilink(t)} />
          )}
        </div>
      </section>

      <SearchPalette
        open={search.open}
        query={search.query}
        hits={search.hits}
        cursor={search.cursor}
        onQuery={(q) => store().querySearch(q)}
        onMove={(d) => store().dispatchSearch({ type: "move", delta: d })}
        onSelect={(hit) => {
          const chosen = hit ?? select(store().search);
          if (chosen) {
            void store().openNote(chosen.path);
            store().dispatchSearch({ type: "close" });
          }
        }}
        onClose={() => store().dispatchSearch({ type: "close" })}
      />
    </div>
  );
}

export default App;
