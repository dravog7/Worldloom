import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { LiveEditor } from "./editor";
import {
  AiSettingsPanel,
  AskPanel,
  BacklinksPanel,
  ExtractionPanel,
  FileTree,
  FindingsPanel,
  SearchPalette,
  select,
} from "./panels";
import { useAiCapability } from "./app/AiGate";
import { chatViaProxy } from "./app/adapters/ai-key";
import { tauriAuditStatePort } from "./app/adapters/audit-state";
import { getIndex, lookupCandidates, useStore } from "./app/store";
import { useFindingsUi } from "./panels/findings-store";

/** M2 right-rail surfaces (audit findings / extraction / ask). */
type RailTab = "audit" | "extract" | "ask";

const auditStatePort = tauriAuditStatePort();

/**
 * I1/M1.1 wiring: header + sidebar (tree, backlinks) + editor area driven by
 * the zustand store. Layout modes (ADR-005): 'live' (default, markdown
 * hidden), 'split' (source + read-only preview), 'source' (raw markdown).
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
  const aiSettings = useStore((s) => s.aiSettings);
  const aiSettingsOpen = useStore((s) => s.aiSettingsOpen);
  const aiKeyPresent = useStore((s) => s.aiKeyPresent);
  const revealRequest = useStore((s) => s.revealRequest);
  const extractDismissed = useStore((s) => s.extractDismissed);
  const store = useStore.getState;
  const capability = useAiCapability();
  const [rail, setRail] = useState<RailTab | null>(null);
  const transport = useMemo(() => ({ chat: chatViaProxy }), []);
  const endpoint = useMemo(
    () => ({ baseUrl: aiSettings.baseUrl, model: aiSettings.model }),
    [aiSettings.baseUrl, aiSettings.model],
  );
  const index = getIndex();
  const currentNote =
    index && currentPath ? index.all().find((n) => n.path === currentPath) ?? null : null;
  const toggleRail = (tab: RailTab) => setRail((r) => (r === tab ? null : tab));

  useEffect(() => {
    void useStore.getState().boot();
  }, []);

  // The findings store is a module singleton that intentionally survives
  // panel unmounts (M2 I4 #2) — so a vault switch must clear it explicitly
  // or paid findings from vault A would render under vault B (I4 H3).
  const lastVaultRef = useRef(vaultName);
  useEffect(() => {
    if (lastVaultRef.current !== vaultName) {
      lastVaultRef.current = vaultName;
      useFindingsUi.getState().reset();
    }
  }, [vaultName]);

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

  return (
    <div className="wl-app">
      <header className="wl-header">
        <span className="wl-title">{vaultName}</span>
        <span className={`wl-chip wl-chip-${editorStatus}`}>{editorStatus}</span>
        <nav className="wl-segment" aria-label="Editor mode">
          {(["live", "source"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`wl-seg${layout === mode ? " wl-seg-active" : ""}`}
              onClick={() => store().setLayout(mode)}
            >
              {mode === "live" ? "Live" : "Source"}
            </button>
          ))}
        </nav>
        <nav className="wl-segment" aria-label="AI panels">
          {(["audit", "extract", "ask"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`wl-seg${rail === tab ? " wl-seg-active" : ""}`}
              onClick={() => toggleRail(tab)}
            >
              {tab === "audit" ? "Audit" : tab === "extract" ? "Extract" : "Ask"}
            </button>
          ))}
        </nav>
        <button className="wl-btn wl-btn-ghost" onClick={() => store().openAiSettings()}>
          AI settings
        </button>
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
        {currentPath && (
          <BacklinksPanel groups={backlinks} onOpen={(p, l) => void store().openNoteAt(p, l)} />
        )}
      </aside>

      <section className={`wl-main wl-layout-${layout}`}>
        <div className="wl-panes">
          {!currentPath && (
            <p className="wl-empty muted">Select a note from the tree, or press Ctrl+K to search.</p>
          )}
          {currentPath && (
            <LiveEditor
              path={currentPath}
              content={currentContent}
              lookup={lookupCandidates}
              onSave={(p, c) => void store().saveNote(p, c)}
              onStatusChange={(s) => useStore.setState({ editorStatus: s })}
              mode={layout === "live" ? "live" : "source"}
              reveal={
                revealRequest && revealRequest.path === currentPath
                  ? { line: revealRequest.line, nonce: revealRequest.nonce }
                  : null
              }
            />
          )}
        </div>
      </section>

      {rail && (
        <aside className="wl-rail" aria-label="AI panel">
          {rail === "audit" && (
            <FindingsPanel
              provider={index}
              auditStatePort={auditStatePort}
              aiSettings={aiSettings}
              aiKeyPresent={aiKeyPresent}
              transport={transport}
              onOpenNote={(p, l) => void store().openNoteAt(p, l)}
            />
          )}
          {rail === "extract" && currentNote && (
            <ExtractionPanel
              note={{
                path: currentNote.path,
                title: currentNote.title,
                body: currentNote.body,
                type: currentNote.type,
                aliases: currentNote.aliases,
                source: currentContent,
              }}
              transport={transport}
              endpoint={endpoint}
              aiConfigured={capability.configured}
              dismissed={new Set(extractDismissed)}
              onDismiss={(h) => store().dismissExtraction(h)}
              onSave={(p, c) => store().saveNote(p, c)}
            />
          )}
          {rail === "extract" && !currentNote && (
            <p className="wl-empty muted">Open a note to extract entities from it.</p>
          )}
          {rail === "ask" && index && (
            <AskPanel
              index={index}
              transport={transport}
              aiConfigured={capability.configured}
              openNotePath={currentPath ?? undefined}
              baseUrl={aiSettings.baseUrl}
              model={aiSettings.model}
              onOpenNote={(p, l) => void store().openNoteAt(p, l)}
              onOpenSettings={() => store().openAiSettings()}
            />
          )}
        </aside>
      )}

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

      <AiSettingsPanel
        open={aiSettingsOpen}
        settings={aiSettings}
        keyPresent={aiKeyPresent}
        onClose={() => store().closeAiSettings()}
        onChange={(next) => store().setAiSettings(next)}
        onSaveKey={(key) => store().saveAiKey(key)}
        onTestConnection={() => store().testAiConnection()}
      />
    </div>
  );
}

export default App;
