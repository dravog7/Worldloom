import "./App.css";

/**
 * Wave A app shell. Deliberately blank — the editor/preview/panels land in
 * Waves B/C. No Tauri IPC is used here: ADR-001 forbids custom Rust
 * commands in M1, and adapters live in src/app.
 */
function App() {
  return (
    <main className="container">
      <h1>Worldloom</h1>
      <p className="muted">Wave A scaffold — the vault shell. Content arrives in Waves B/C.</p>
    </main>
  );
}

export default App;
