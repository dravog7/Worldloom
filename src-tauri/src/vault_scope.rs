//! M2.5 I3 — fs-scope hardening: dynamic, vault-only filesystem scope.
//!
//! The shipped capability file (`capabilities/default.json`) grants NO static
//! `fs:scope` — a compromised renderer starts with access only to the
//! app-specific dirs (`fs:default`, needed by plugin-store) and nothing else.
//! Vault access arrives one directory at a time, from two Rust-side paths:
//!
//! 1. **User pick** — `tauri-plugin-dialog` auto-allows exactly the folder the
//!    user chose in the picker (`open({ directory, recursive: true })`), so
//!    every fresh grant is tied to a visible, user-driven dialog.
//! 2. **Boot reopen** — the renderer re-opens the persisted vault at startup
//!    without a dialog; [`grant_persisted_vault_scope`] re-grants that one
//!    path after [`sanitize_vault_grant`] vets it.
//!
//! Threat model for path (2): the settings JSON is writable by the renderer
//! (plugin-store), so a compromised renderer could aim the boot grant at an
//! arbitrary path. Mitigations, strongest first: the grant requires an app
//! restart; it can only ever name ONE directory; and the sanitizer refuses
//! non-directories, relative paths, the filesystem root, and the user's home
//! directory itself. The residual risk (one arbitrary *existing* directory
//! per restart) is the price of dialog-free boot reopen — strictly narrower
//! than the old blanket `$HOME/**` capability, which handed over the whole
//! home tree with zero user action.

use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// Settings file written by `@tauri-apps/plugin-store`. The plugin resolves
/// it against the app data dir (`BaseDirectory::AppData`, see
/// `tauri-plugin-store/src/store.rs::resolve_store_path`), so the Rust side
/// must read the same location.
pub(crate) const SETTINGS_FILE: &str = "worldloom-settings.json";
/// Key inside the settings file holding the last-opened vault directory.
pub(crate) const VAULT_PATH_KEY: &str = "vaultPath";

/// Best-effort home directory, used only to REFUSE grants (never to allow).
fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// Vet a persisted vault path before it may enter the fs scope.
///
/// Returns the canonicalized path on success so grants never contain `..`
/// segments or symlink tricks that could escape the directory the user
/// opened.
pub(crate) fn sanitize_vault_grant(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("vault path must not be empty".into());
    }
    let path = Path::new(trimmed);
    if !path.is_absolute() {
        return Err(format!(
            "vault path must be absolute, got `{trimmed}` (grant refused)"
        ));
    }
    // Canonicalize FIRST: resolves `..` segments and symlink hops so every
    // later check (and the grant itself) sees the real location.
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("cannot resolve {}: {e}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", canonical.display()));
    }
    // The filesystem root (`C:\`, `/`) canonicalizes to itself and has no
    // parent — granting it would be a blanket scope by another name.
    if canonical.parent().is_none() {
        return Err(format!(
            "refusing to grant the filesystem root {}",
            canonical.display()
        ));
    }
    // The home directory ITSELF is refused: it is exactly the blanket scope
    // this module exists to eliminate. (Subdirectories of home — where vaults
    // normally live — are fine.)
    if let Some(home) = home_dir().and_then(|h| h.canonicalize().ok()) {
        if canonical == home {
            return Err(format!(
                "refusing to grant the home directory itself {} — pick a vault subfolder",
                canonical.display()
            ));
        }
    }
    Ok(canonical)
}

/// Re-grant the persisted vault directory into the fs scope (boot path).
///
/// Missing/unreadable/invalid state means `Ok(())` with NO grant (fail
/// closed: the renderer then shows its no-vault state instead of a vault it
/// cannot read).
pub(crate) fn grant_persisted_vault_scope<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cannot resolve app data dir: {e}"))?;
    let settings_path = data_dir.join(SETTINGS_FILE);
    let content = match std::fs::read_to_string(&settings_path) {
        Ok(content) => content,
        // First run — nothing persisted yet, nothing to grant.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("cannot read {}: {e}", settings_path.display())),
    };
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("{} is not valid JSON: {e}", settings_path.display()))?;
    let Some(raw) = json.get(VAULT_PATH_KEY).and_then(|v| v.as_str()) else {
        return Ok(());
    };
    let path = sanitize_vault_grant(raw)?;
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| format!("fs scope grant failed for {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique-per-run scratch path under the system temp dir.
    fn scratch(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("wl-i3-scope-{tag}-{}-{nanos}", std::process::id()))
    }

    // ---------- sanitize_vault_grant ----------

    #[test]
    fn accepts_an_existing_directory() {
        let dir = scratch("ok");
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        let granted = sanitize_vault_grant(&dir.to_string_lossy()).expect("directory allowed");
        assert!(granted.is_dir(), "grant must be a directory");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_empty_and_whitespace() {
        assert!(sanitize_vault_grant("").is_err());
        assert!(sanitize_vault_grant("   \t ").is_err());
    }

    #[test]
    fn rejects_relative_paths() {
        let err = sanitize_vault_grant("vaults/myworld").expect_err("relative must be refused");
        assert!(err.contains("absolute"), "{err}");
    }

    #[test]
    fn rejects_missing_paths() {
        let missing = scratch("missing");
        assert!(sanitize_vault_grant(&missing.to_string_lossy()).is_err());
    }

    #[test]
    fn rejects_files_that_are_not_directories() {
        let file = scratch("file");
        std::fs::write(&file, "not a directory").expect("create scratch file");
        let err = sanitize_vault_grant(&file.to_string_lossy()).expect_err("file must be refused");
        assert!(err.contains("not a directory"), "{err}");
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn refuses_the_filesystem_root() {
        #[cfg(windows)]
        let root = "C:\\";
        #[cfg(not(windows))]
        let root = "/";
        let err = sanitize_vault_grant(root).expect_err("root must be refused");
        assert!(err.contains("filesystem root"), "{err}");
    }

    #[test]
    fn refuses_the_home_directory_itself() {
        let Some(home) = home_dir() else {
            return; // no HOME/USERPROFILE in this environment — nothing to prove
        };
        let err = sanitize_vault_grant(&home.to_string_lossy()).expect_err("home must be refused");
        assert!(err.contains("home"), "{err}");
    }

    // ---------- capability regression tripwire ----------

    #[test]
    fn capability_json_grants_no_blanket_fs_scope() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json");
        let raw = std::fs::read_to_string(path).expect("capability file readable");
        assert!(
            !raw.contains("$HOME"),
            "blanket $HOME scope is back in {path}: {raw}"
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&raw).expect("capability file is valid JSON");
        let perms = parsed
            .get("permissions")
            .and_then(|p| p.as_array())
            .expect("permissions array");
        for entry in perms {
            if let Some(id) = entry.as_str() {
                assert_ne!(
                    id, "fs:scope",
                    "static fs:scope entry is back in {path}: {entry}"
                );
            } else if let Some(obj) = entry.as_object() {
                assert_ne!(
                    obj.get("identifier").and_then(|v| v.as_str()),
                    Some("fs:scope"),
                    "static fs:scope entry is back in {path}: {entry}"
                );
            }
        }
    }
}
