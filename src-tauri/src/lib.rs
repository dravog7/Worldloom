// Worldloom Tauri shell — plugins only, NO custom Rust commands in M1 (ADR-001).
// M2 Wave A1 adds the keyring commands sanctioned by ADR-006 (see ai_key.rs);
// Wave A2 adds the ai_chat proxy — the app's only AI network egress path.
mod ai_chat;
mod ai_key;
mod vault_scope;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            ai_key::key_set,
            ai_key::key_get_status,
            ai_key::key_delete,
            ai_chat::ai_chat
        ])
        .setup(|app| {
            // M2.5 I3 (fs scope): the renderer re-opens the last vault at boot
            // WITHOUT a dialog, so the Rust side re-grants that ONE directory
            // (sanitized by vault_scope) into the fs scope. Deliberately
            // non-fatal: no settings file / no vault / corrupt JSON all just
            // mean "no grant" and the renderer shows its no-vault state.
            let _ = vault_scope::grant_persisted_vault_scope(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
