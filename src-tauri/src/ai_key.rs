//! M2 Wave A1 (ADR-006 §2): OS-keyring storage for the BYO AI API key.
//!
//! The key lives in the OS credential store (Windows Credential Manager /
//! macOS Keychain / SecretService) and NEVER enters the renderer: commands
//! only set / delete it and report *presence*, never the value.
//!
//! App-defined commands need no capability entries in Tauri v2, but they do
//! need registration: see `generate_handler!` in `lib.rs`.
//!
//! # Manual devtools smoke (`npm run tauri dev`, F12 console)
//!
//! ```js
//! window.__TAURI_INTERNALS__.invoke('key_set', { key: 'x' })
//! window.__TAURI_INTERNALS__.invoke('key_get_status')  // true
//! window.__TAURI_INTERNALS__.invoke('key_delete')
//! window.__TAURI_INTERNALS__.invoke('key_get_status')  // false
//! ```
//! (`invoke('key_set', {key:'x'})` also works if `withGlobalTauri` is enabled.)

use serde::Serialize;
use thiserror::Error;

/// Credential-manager service name for the shipped app (matches the Tauri
/// bundle identifier in tauri.conf.json).
pub const KEYRING_SERVICE: &str = "com.worldloom.app";
/// Credential-manager account holding the single AI API key.
pub const KEYRING_ACCOUNT: &str = "ai-api-key";

/// Errors surfaced to the renderer by the keyring commands. Deliberately
/// carries no secret material — only the keyring error kind + message.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum KeyringError {
    /// Underlying OS keyring failure (message is keyring's Display, never the
    /// stored secret).
    #[error("keyring storage error: {0}")]
    Storage(String),
    /// Caller passed an empty (or whitespace-only) key.
    #[error("API key must not be empty")]
    EmptyKey,
}

fn storage_err(e: keyring::Error) -> KeyringError {
    KeyringError::Storage(e.to_string())
}

/// Store `key` under (service, account), replacing any existing value.
pub fn keyring_set(service: &str, account: &str, key: &str) -> Result<(), KeyringError> {
    if key.trim().is_empty() {
        return Err(KeyringError::EmptyKey);
    }
    let entry = keyring::Entry::new(service, account).map_err(storage_err)?;
    entry.set_password(key).map_err(storage_err)
}

/// `true` iff a key is stored. Missing entry is `Ok(false)`, not an error.
pub fn keyring_status(service: &str, account: &str) -> Result<bool, KeyringError> {
    let entry = keyring::Entry::new(service, account).map_err(storage_err)?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(storage_err(e)),
    }
}

/// Delete the stored key. Idempotent: deleting a missing entry is `Ok(())`.
pub fn keyring_delete(service: &str, account: &str) -> Result<(), KeyringError> {
    let entry = keyring::Entry::new(service, account).map_err(storage_err)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(storage_err(e)),
    }
}

#[tauri::command]
pub fn key_set(key: String) -> Result<(), KeyringError> {
    keyring_set(KEYRING_SERVICE, KEYRING_ACCOUNT, &key)
}

#[tauri::command]
pub fn key_get_status() -> Result<bool, KeyringError> {
    keyring_status(KEYRING_SERVICE, KEYRING_ACCOUNT)
}

#[tauri::command]
pub fn key_delete() -> Result<(), KeyringError> {
    keyring_delete(KEYRING_SERVICE, KEYRING_ACCOUNT)
}

#[cfg(test)]
mod tests {
    use super::KeyringError;

    /// Test-scoped service so cargo test never touches the real credential.
    const TEST_SERVICE: &str = "com.worldloom.app.test";

    /// Unique-per-run account with guaranteed cleanup (even on panic).
    struct TestCred {
        account: String,
    }

    impl TestCred {
        fn new() -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock before epoch")
                .as_nanos();
            let account = format!("a1-test-{}-{}", std::process::id(), nanos);
            let _ = super::keyring_delete(TEST_SERVICE, &account); // clean slate
            TestCred { account }
        }
    }

    impl Drop for TestCred {
        fn drop(&mut self) {
            let _ = super::keyring_delete(TEST_SERVICE, &self.account);
        }
    }

    #[test]
    fn roundtrip_set_status_delete() {
        let cred = TestCred::new();
        super::keyring_set(TEST_SERVICE, &cred.account, "dummy-test-key-not-real").expect("set");
        assert!(super::keyring_status(TEST_SERVICE, &cred.account).expect("status"));
        super::keyring_delete(TEST_SERVICE, &cred.account).expect("delete");
        assert!(!super::keyring_status(TEST_SERVICE, &cred.account).expect("status"));
    }

    #[test]
    fn status_missing_entry_is_false_not_error() {
        let cred = TestCred::new();
        assert!(!super::keyring_status(TEST_SERVICE, &cred.account).expect("status"));
    }

    #[test]
    fn delete_missing_entry_is_ok_idempotent() {
        let cred = TestCred::new();
        super::keyring_delete(TEST_SERVICE, &cred.account).expect("delete of absent key is Ok");
    }

    #[test]
    fn set_rejects_empty_and_whitespace_keys() {
        let cred = TestCred::new();
        assert!(matches!(
            super::keyring_set(TEST_SERVICE, &cred.account, ""),
            Err(KeyringError::EmptyKey)
        ));
        assert!(matches!(
            super::keyring_set(TEST_SERVICE, &cred.account, "   "),
            Err(KeyringError::EmptyKey)
        ));
        assert!(!super::keyring_status(TEST_SERVICE, &cred.account).expect("status"));
    }

    #[test]
    fn set_twice_overwrites_and_status_stays_true() {
        let cred = TestCred::new();
        super::keyring_set(TEST_SERVICE, &cred.account, "dummy-a").expect("set a");
        super::keyring_set(TEST_SERVICE, &cred.account, "dummy-b").expect("set b");
        assert!(super::keyring_status(TEST_SERVICE, &cred.account).expect("status"));
    }
}
