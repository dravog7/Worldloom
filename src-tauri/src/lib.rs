// Worldloom Tauri shell — plugins only, NO custom Rust commands in M1 (ADR-001).
// M2 Wave A1 adds the keyring commands sanctioned by ADR-006 (see ai_key.rs).
mod ai_key;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            ai_key::key_set,
            ai_key::key_get_status,
            ai_key::key_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
