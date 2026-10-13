//! M2 Wave A2 (ADR-006 §1, §3): the AI chat proxy — the app's ONLY AI network
//! egress path.
//!
//! The renderer sends a [`ChatRequest`] (frozen contract: src/core/ai/types.ts);
//! this command reads the BYO API key from the OS keyring via `ai_key`, calls
//! the OpenAI-compatible `{base}/chat/completions` endpoint, and returns
//! `{ content, usage?, latency_ms }`. The key NEVER enters the renderer and is
//! never part of any value returned here.
//!
//! Security posture (ADR-006 §3):
//! - [`validate_endpoint`] runs BEFORE the reqwest client is constructed;
//!   `invalid-endpoint` means no socket is ever opened. Only `https:` is
//!   accepted generally; plain `http:` only for loopback (127.0.0.1 /
//!   localhost) so local models (Ollama) work keyless.
//! - Redirects are never followed (`Policy::none()`), so a hostile endpoint
//!   cannot bounce the authorized request to another host.
//! - Response body capped at 8MB, enforced while streaming (chunked reads,
//!   abort past the cap; declared Content-Length is checked first as a fast
//!   path).
//! - 120s total request timeout.
//!
//! # Manual devtools smoke (`npm run tauri dev`, F12 console; requires key_set
//! # first for remote endpoints)
//!
//! ```js
//! window.__TAURI_INTERNALS__.invoke('ai_chat', { request: {
//!   baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
//!   messages: [{ role: 'user', content: 'ping' }] } })
//! ```

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::ai_key::{KEYRING_ACCOUNT, KEYRING_SERVICE, keyring_get};

/// Hard cap on response body size (ADR-006 §3), enforced while streaming.
pub(crate) const MAX_BODY_BYTES: u64 = 8 * 1024 * 1024;
/// Total request timeout (ADR-006 §3).
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// Read granularity for the streaming body-cap enforcement.
const READ_CHUNK: usize = 16 * 1024;

/// Errors surfaced to the renderer by `ai_chat`, serialized as `{ kind,
/// message }` — kebab-case kinds match the frozen `AiErrorKind` union in
/// src/core/ai/types.ts exactly. Never carries key material: reqwest's error
/// Display may include the URL, and the key only ever travels in the
/// Authorization header, never in the URL.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "kebab-case")]
pub enum AiError {
    /// 401/403 from the provider.
    #[error("auth error: {0}")]
    Auth(String),
    /// Any other non-2xx — including 3xx, since redirects are never followed.
    #[error("http error: {0}")]
    Http(String),
    /// The 120s budget elapsed.
    #[error("timeout: {0}")]
    Timeout(String),
    /// 2xx but not a parseable OpenAI chat-completion body — or oversized.
    #[error("invalid response: {0}")]
    InvalidResponse(String),
    /// DNS / connect / TLS / body-read failure.
    #[error("network error: {0}")]
    Network(String),
    /// Non-local endpoint and no key in the OS keyring.
    #[error("no key: {0}")]
    NoKey(String),
    /// base_url rejected by pure validation — no socket was opened.
    #[error("invalid endpoint: {0}")]
    InvalidEndpoint(String),
}

/// One chat message, OpenAI wire shape (frozen TS `ChatMessage`).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

/// Message role. The frozen contract allows exactly these three; anything
/// else fails request deserialization at the invoke boundary.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

/// What the renderer sends. Field names follow the frozen TS `ChatRequest`
/// EXACTLY — `baseUrl` camelCase, `max_tokens` snake_case; do not normalize.
#[derive(Debug, Clone, Deserialize)]
pub struct ChatRequest {
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: Option<f64>,
    pub max_tokens: Option<u32>,
}

/// Token accounting as reported by the provider (OpenAI `usage` shape).
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub struct TokenUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
}

/// Success shape handed to the renderer (frozen TS `AiResponse` after the
/// adapter camelCases `latency_ms`).
#[derive(Debug, Serialize)]
pub struct ChatResponse {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<TokenUsage>,
    pub latency_ms: u64,
}

/// Result of validating a renderer-supplied base_url. Pure data — unit-tested.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedEndpoint {
    /// URL with surrounding whitespace and trailing slashes trimmed, ready for
    /// `{base}/chat/completions` joining.
    pub base: String,
    /// Loopback endpoint (Ollama & friends): callable without an API key.
    pub is_local: bool,
}

/// Validate `base_url` WITHOUT touching the network (ADR-006 §3).
/// `reqwest::Url::parse` is a pure parse — no client is constructed and no
/// socket is opened. This MUST stay the first step of [`ai_chat`].
pub(crate) fn validate_endpoint(base_url: &str) -> Result<ValidatedEndpoint, AiError> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return Err(AiError::InvalidEndpoint(
            "base_url must not be empty".into(),
        ));
    }
    let url = reqwest::Url::parse(trimmed)
        .map_err(|e| AiError::InvalidEndpoint(format!("not a parseable URL: {e}")))?;
    if url.cannot_be_a_base() || url.host_str().is_none() {
        return Err(AiError::InvalidEndpoint(
            "URL must include a scheme and host".into(),
        ));
    }
    let is_local = match url.scheme() {
        "https" => false,
        "http" => {
            let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
            if host != "127.0.0.1" && host != "localhost" {
                return Err(AiError::InvalidEndpoint(format!(
                    "plain http:// is only allowed for local endpoints \
                     (127.0.0.1 / localhost), got host `{host}`"
                )));
            }
            true
        }
        other => {
            return Err(AiError::InvalidEndpoint(format!(
                "scheme `{other}` is not allowed; use https:// \
                 (or http://127.0.0.1 / http://localhost for local models)"
            )));
        }
    };
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AiError::InvalidEndpoint(
            "credentials embedded in base_url are not allowed".into(),
        ));
    }
    Ok(ValidatedEndpoint {
        base: trimmed.trim_end_matches('/').to_string(),
        is_local,
    })
}

/// Build the OpenAI chat-completions JSON body (pure). Optional fields are
/// OMITTED when absent — explicit nulls upset some providers.
pub(crate) fn build_body(request: &ChatRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
    });
    if let Some(t) = request.temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(m) = request.max_tokens {
        body["max_tokens"] = serde_json::json!(m);
    }
    body
}

/// Map an HTTP status onto the error taxonomy (pure). `snippet` is the
/// already-size-capped response body, included for user-facing context.
pub(crate) fn map_status(status: u16, snippet: Option<&str>) -> Result<(), AiError> {
    if (200..300).contains(&status) {
        return Ok(());
    }
    let with_body = |msg: String| match snippet {
        Some(s) if !s.is_empty() => {
            format!("{msg} — {}", s.chars().take(200).collect::<String>())
        }
        _ => msg,
    };
    Err(match status {
        401 | 403 => AiError::Auth(with_body(format!(
            "provider rejected the request (HTTP {status}); \
             check the stored API key / model access"
        ))),
        300..=399 => AiError::Http(with_body(format!(
            "unexpected redirect (HTTP {status}); redirects are disabled"
        ))),
        _ => AiError::Http(with_body(format!("provider returned HTTP {status}"))),
    })
}

/// Enforce the 8MB cap while streaming (pure): a chunk that would push the
/// accumulated size past the cap is rejected so the caller aborts without
/// buffering the rest. `saturating_add` guards the arithmetic itself.
pub(crate) fn guard_chunk(acc_len: usize, chunk_len: usize) -> Result<(), AiError> {
    let total = acc_len.saturating_add(chunk_len) as u64;
    if total > MAX_BODY_BYTES {
        return Err(AiError::InvalidResponse(format!(
            "response body exceeds the {MAX_BODY_BYTES}-byte cap"
        )));
    }
    Ok(())
}

/// Fast path for a server-declared Content-Length: abort before reading a body
/// that is already over the cap.
pub(crate) fn guard_declared_len(len: Option<u64>) -> Result<(), AiError> {
    if len.is_some_and(|l| l > MAX_BODY_BYTES) {
        return Err(AiError::InvalidResponse(format!(
            "declared response body size exceeds the {MAX_BODY_BYTES}-byte cap"
        )));
    }
    Ok(())
}

/// Extract `(content, usage?)` from a response body (pure). Strict on content
/// (missing/unparseable ⇒ `invalid-response`), lenient on usage (absent or
/// malformed ⇒ `None` — token accounting must never fail a chat).
pub(crate) fn extract_content(body: &str) -> Result<(String, Option<TokenUsage>), AiError> {
    let value: serde_json::Value = serde_json::from_str(body)
        .map_err(|e| AiError::InvalidResponse(format!("body is not valid JSON: {e}")))?;
    let content = value
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .ok_or_else(|| {
            AiError::InvalidResponse("missing string choices[0].message.content".into())
        })?;
    let usage = value
        .get("usage")
        .cloned()
        .and_then(|u| serde_json::from_value::<TokenUsage>(u).ok());
    Ok((content.to_string(), usage))
}

/// Read the response body in chunks, aborting past the 8MB cap.
fn read_capped(resp: &mut reqwest::blocking::Response) -> Result<String, AiError> {
    use std::io::Read;
    guard_declared_len(resp.content_length())?;
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; READ_CHUNK];
    loop {
        let n = resp
            .read(&mut chunk)
            .map_err(|e| AiError::Network(format!("failed reading response body: {e}")))?;
        if n == 0 {
            break;
        }
        guard_chunk(buf.len(), n)?;
        buf.extend_from_slice(&chunk[..n]);
    }
    String::from_utf8(buf).map_err(|e| AiError::InvalidResponse(format!("body is not UTF-8: {e}")))
}

/// Classify a `send()` failure (pure-ish: consumes the error, no I/O here).
fn map_send_error(e: reqwest::Error) -> AiError {
    if e.is_timeout() {
        AiError::Timeout(format!("no response within {}s", REQUEST_TIMEOUT.as_secs()))
    } else {
        AiError::Network(e.to_string())
    }
}

/// Perform the POST against `{base}/chat/completions`. `api_key` may be empty
/// for local endpoints, in which case no Authorization header is sent.
pub(crate) fn chat_over_http(
    endpoint: &ValidatedEndpoint,
    api_key: &str,
    body: &serde_json::Value,
) -> Result<(String, Option<TokenUsage>), AiError> {
    let url = format!("{}/chat/completions", endpoint.base);
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| AiError::Network(format!("failed to build HTTP client: {e}")))?;
    let mut req = client.post(&url).json(body);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {api_key}"));
    }
    let mut resp = req.send().map_err(map_send_error)?;
    let status = resp.status().as_u16();
    // Even error statuses get a (capped) body read so the message can carry a
    // provider-supplied snippet; the cap protects us from hostile error pages.
    let body_text = read_capped(&mut resp)?;
    map_status(status, Some(&body_text))?;
    extract_content(&body_text)
}

/// The app's single AI network-egress path (ADR-006 §1). Runs on Tauri's
/// blocking thread pool (`(async)` marker) so the UI never blocks on the 120s
/// budget. The renderer never sees the key.
#[tauri::command(async)]
pub fn ai_chat(request: ChatRequest) -> Result<ChatResponse, AiError> {
    let started = Instant::now();
    // Step 1: reject bad endpoints BEFORE any HTTP client exists — no socket.
    let endpoint = validate_endpoint(&request.base_url)?;
    // Step 2: key material. Local endpoints run keyless; remote ones need the
    // keyring key (KeyringError messages never contain the secret).
    let api_key = if endpoint.is_local {
        String::new()
    } else {
        match keyring_get(KEYRING_SERVICE, KEYRING_ACCOUNT) {
            Ok(Some(key)) => key,
            Ok(None) => {
                return Err(AiError::NoKey(
                    "no API key stored — save one with key_set before using \
                     a remote endpoint"
                        .into(),
                ));
            }
            Err(e) => {
                return Err(AiError::Network(format!(
                    "failed to read API key from OS keyring: {e}"
                )));
            }
        }
    };
    // Step 3: perform the request, enforce the cap, decode the response.
    let body = build_body(&request);
    let (content, usage) = chat_over_http(&endpoint, &api_key, &body)?;
    Ok(ChatResponse {
        content,
        usage,
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- validate_endpoint (pure, zero sockets) ----------

    #[test]
    fn validator_accepts_https_remote() {
        let ep = super::validate_endpoint("https://api.openai.com/v1").expect("valid https");
        assert_eq!(ep.base, "https://api.openai.com/v1");
        assert!(!ep.is_local);
    }

    #[test]
    fn validator_accepts_loopback_http_and_marks_local() {
        for url in ["http://127.0.0.1:11434/v1", "http://localhost:11434"] {
            let ep = super::validate_endpoint(url).expect("loopback http ok");
            assert!(ep.is_local, "{url} should be marked local");
        }
    }

    #[test]
    fn validator_rejects_plain_http_to_remote_hosts() {
        let err = super::validate_endpoint("http://api.openai.com/v1")
            .expect_err("remote plain http must be rejected");
        assert!(matches!(err, AiError::InvalidEndpoint(_)), "{err:?}");
    }

    #[test]
    fn validator_rejects_non_http_schemes_and_schemeless() {
        for bad in [
            "ftp://example.com",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "api.openai.com/v1",
            "",
        ] {
            let err = match super::validate_endpoint(bad) {
                Err(e) => e,
                Ok(_) => panic!("{bad:?} should be rejected"),
            };
            assert!(matches!(err, AiError::InvalidEndpoint(_)), "{bad:?}");
        }
    }

    #[test]
    fn validator_rejects_embedded_credentials_and_hostless_urls() {
        assert!(matches!(
            super::validate_endpoint("https://user:pass@example.com/v1"),
            Err(AiError::InvalidEndpoint(_))
        ));
        assert!(matches!(
            super::validate_endpoint("https://"),
            Err(AiError::InvalidEndpoint(_))
        ));
    }

    #[test]
    fn validator_trims_whitespace_and_trailing_slashes() {
        let ep = super::validate_endpoint("  https://api.openai.com/v1/  ").expect("trimmable url");
        assert_eq!(ep.base, "https://api.openai.com/v1");
    }

    /// Security invariant: hostile inputs are rejected by PURE URL parsing —
    /// no reqwest client is constructed, so no socket can be opened. If this
    /// function ever touched the network it would hang here.
    #[test]
    fn validator_rejects_hostile_inputs_with_no_network_access() {
        for bad in [
            "http://169.254.169.254/latest/meta-data", // cloud metadata via plain http
            "ws://example.com",
            "https://",
            "http://user@evil.example.com",
        ] {
            assert!(
                super::validate_endpoint(bad).is_err(),
                "{bad} must be rejected"
            );
        }
    }

    // ---------- map_status ----------

    #[test]
    fn status_mapping_covers_the_taxonomy() {
        assert!(super::map_status(200, None).is_ok());
        assert!(super::map_status(204, None).is_ok());
        assert!(matches!(
            super::map_status(401, None),
            Err(AiError::Auth(_))
        ));
        assert!(matches!(
            super::map_status(403, None),
            Err(AiError::Auth(_))
        ));
        assert!(matches!(
            super::map_status(404, None),
            Err(AiError::Http(_))
        ));
        assert!(matches!(
            super::map_status(500, None),
            Err(AiError::Http(_))
        ));
        assert!(matches!(
            super::map_status(302, None),
            Err(AiError::Http(_))
        ));
    }

    #[test]
    fn status_mapping_carries_code_and_body_snippet() {
        let err =
            super::map_status(429, Some("rate limited, slow down")).expect_err("429 is an error");
        let msg = err.to_string();
        assert!(
            msg.contains("429"),
            "message should carry the status: {msg}"
        );
        assert!(
            msg.contains("rate limited"),
            "message should carry the snippet: {msg}"
        );
    }

    // ---------- body-cap guards ----------

    #[test]
    fn body_cap_guard_allows_up_to_8mb_and_aborts_past() {
        assert!(super::guard_chunk(0, 1024).is_ok());
        // exactly at the cap is allowed; one byte past aborts
        assert!(super::guard_chunk((8 * 1024 * 1024) - 10, 10).is_ok());
        assert!(matches!(
            super::guard_chunk(8 * 1024 * 1024, 1),
            Err(AiError::InvalidResponse(_))
        ));
        // arithmetic itself saturates
        assert!(matches!(
            super::guard_chunk(usize::MAX, 1),
            Err(AiError::InvalidResponse(_))
        ));
    }

    #[test]
    fn declared_content_length_fast_path() {
        assert!(super::guard_declared_len(None).is_ok());
        assert!(super::guard_declared_len(Some(8 * 1024 * 1024)).is_ok());
        assert!(matches!(
            super::guard_declared_len(Some(8 * 1024 * 1024 + 1)),
            Err(AiError::InvalidResponse(_))
        ));
    }

    // ---------- extract_content ----------

    #[test]
    fn extract_content_parses_usage_and_handles_absence() {
        let ok = r#"{"choices":[{"message":{"role":"assistant","content":"hello"}}],"usage":{"prompt_tokens":12,"completion_tokens":3}}"#;
        let (content, usage) = super::extract_content(ok).expect("parse ok");
        assert_eq!(content, "hello");
        assert_eq!(
            usage,
            Some(TokenUsage {
                prompt_tokens: 12,
                completion_tokens: 3
            })
        );

        let no_usage = r#"{"choices":[{"message":{"content":"hi"}}]}"#;
        let (content, usage) = super::extract_content(no_usage).expect("parse ok");
        assert_eq!(content, "hi");
        assert_eq!(usage, None);
    }

    #[test]
    fn extract_content_lenient_on_malformed_usage_strict_on_content() {
        // usage is optional accounting — malformed ⇒ None, never an error
        let bad_usage =
            r#"{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":"x"}}"#;
        let (content, usage) = super::extract_content(bad_usage).expect("usage is lenient");
        assert_eq!(content, "ok");
        assert_eq!(usage, None);

        for bad in [
            "not json at all",
            r#"{"error":{"message":"boom"}}"#,
            r#"{"choices":[{"message":{"content":null}}]}"#,
            r#"{"choices":[]}"#,
        ] {
            assert!(
                matches!(
                    super::extract_content(bad),
                    Err(AiError::InvalidResponse(_))
                ),
                "{bad} should map to invalid-response"
            );
        }
    }

    // ---------- build_body ----------

    #[test]
    fn build_body_omits_absent_optionals_includes_present_ones() {
        let mk = |temperature: Option<f64>, max_tokens: Option<u32>| ChatRequest {
            base_url: "https://api.example.com/v1".into(),
            model: "test-model".into(),
            messages: vec![ChatMessage {
                role: Role::User,
                content: "hi".into(),
            }],
            temperature,
            max_tokens,
        };
        let body = super::build_body(&mk(None, None));
        assert_eq!(body["model"], "test-model");
        assert!(
            body.get("temperature").is_none(),
            "absent optionals must be omitted"
        );
        assert!(
            body.get("max_tokens").is_none(),
            "absent optionals must be omitted"
        );

        let body = super::build_body(&mk(Some(0.2), Some(512)));
        assert_eq!(body["temperature"], 0.2);
        assert_eq!(body["max_tokens"], 512);
    }

    // ---------- frozen wire contract ----------

    #[test]
    fn request_deserializes_from_frozen_ts_shape() {
        let full = r#"{"baseUrl":"https://api.openai.com/v1","model":"gpt-4o-mini","messages":[{"role":"system","content":"s"},{"role":"user","content":"u"},{"role":"assistant","content":"a"}],"temperature":0.7,"max_tokens":256}"#;
        let req: ChatRequest = serde_json::from_str(full).expect("frozen TS ChatRequest shape");
        assert_eq!(req.base_url, "https://api.openai.com/v1");
        assert_eq!(req.messages.len(), 3);
        assert_eq!(req.temperature, Some(0.7));
        assert_eq!(req.max_tokens, Some(256));

        // optionals are truly optional
        let minimal = r#"{"baseUrl":"http://localhost:11434","model":"llama","messages":[{"role":"user","content":"u"}]}"#;
        let req: ChatRequest = serde_json::from_str(minimal).expect("minimal shape");
        assert_eq!(req.temperature, None);
        assert_eq!(req.max_tokens, None);
    }

    #[test]
    fn errors_and_response_serialize_to_frozen_shapes() {
        // {kind, message} matches the frozen AiErrorKind kebab-case union
        let value = serde_json::to_value(AiError::NoKey("nope".into())).expect("serialize");
        assert_eq!(
            value,
            serde_json::json!({"kind": "no-key", "message": "nope"})
        );
        for (err, kind) in [
            (AiError::Auth("x".into()), "auth"),
            (AiError::Http("x".into()), "http"),
            (AiError::Timeout("x".into()), "timeout"),
            (AiError::InvalidResponse("x".into()), "invalid-response"),
            (AiError::Network("x".into()), "network"),
            (AiError::InvalidEndpoint("x".into()), "invalid-endpoint"),
        ] {
            let value = serde_json::to_value(&err).expect("serialize");
            assert_eq!(value["kind"], kind, "kind must be kebab-case: {value}");
            assert!(
                value["message"].is_string(),
                "message must always be present: {value}"
            );
        }

        let resp = ChatResponse {
            content: "c".into(),
            usage: None,
            latency_ms: 42,
        };
        assert_eq!(
            serde_json::to_value(&resp).expect("serialize"),
            serde_json::json!({"content": "c", "latency_ms": 42})
        );
        let resp = ChatResponse {
            content: "c".into(),
            usage: Some(TokenUsage {
                prompt_tokens: 1,
                completion_tokens: 2,
            }),
            latency_ms: 7,
        };
        assert_eq!(
            serde_json::to_value(&resp).expect("serialize"),
            serde_json::json!({"content": "c", "usage": {"prompt_tokens": 1, "completion_tokens": 2}, "latency_ms": 7})
        );
    }

    // ---------- integration: real reqwest vs std::net TcpListener ----------

    /// Drain a full HTTP/1.1 request (headers + declared body) so the socket
    /// has no unread data when we close it (avoids RST on Windows).
    fn drain_request(stream: &mut std::net::TcpStream) {
        use std::io::Read;
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut acc: Vec<u8> = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    acc.extend_from_slice(&buf[..n]);
                    if let Some(pos) = acc.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&acc[..pos]).to_ascii_lowercase();
                        let declared: usize = head
                            .lines()
                            .find_map(|l| l.strip_prefix("content-length:"))
                            .and_then(|v| v.trim().parse().ok())
                            .unwrap_or(0);
                        if acc.len() >= pos + 4 + declared {
                            break;
                        }
                    }
                }
                Err(_) => break, // read timeout: client sent what it sent
            }
        }
    }

    /// Serve exactly one canned response on an ephemeral 127.0.0.1 port.
    /// Returns the base URL and the server thread's join handle.
    fn serve(canned_response: String) -> (String, std::thread::JoinHandle<()>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let addr = listener.local_addr().expect("local addr");
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                drain_request(&mut stream);
                let _ = std::io::Write::write_all(&mut stream, canned_response.as_bytes());
                let _ = stream.shutdown(std::net::Shutdown::Write);
            }
        });
        (format!("http://{addr}"), handle)
    }

    fn response_with_body(status: u16, reason: &str, content_type: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    /// Loopback base URL ⇒ endpoint.is_local ⇒ no keyring access in tests.
    fn local_request(base: &str) -> ChatRequest {
        ChatRequest {
            base_url: base.to_string(),
            model: "test-model".into(),
            messages: vec![ChatMessage {
                role: Role::User,
                content: "hi".into(),
            }],
            temperature: None,
            max_tokens: None,
        }
    }

    #[test]
    fn ai_chat_happy_path_against_local_server() {
        let body = r#"{"choices":[{"message":{"role":"assistant","content":"Hello, world!"}}],"usage":{"prompt_tokens":9,"completion_tokens":4}}"#;
        let (base, server) = serve(response_with_body(200, "OK", "application/json", body));
        let resp = super::ai_chat(local_request(&base)).expect("happy path");
        assert_eq!(resp.content, "Hello, world!");
        assert_eq!(
            resp.usage,
            Some(TokenUsage {
                prompt_tokens: 9,
                completion_tokens: 4
            })
        );
        assert!(resp.latency_ms < 120_000);
        server.join().expect("server thread");
    }

    #[test]
    fn ai_chat_maps_401_to_auth_error() {
        let body = r#"{"error":{"message":"bad key"}}"#;
        let (base, server) = serve(response_with_body(
            401,
            "Unauthorized",
            "application/json",
            body,
        ));
        let err = super::ai_chat(local_request(&base)).expect_err("401");
        assert!(matches!(err, AiError::Auth(_)), "{err:?}");
        server.join().expect("server thread");
    }

    #[test]
    fn ai_chat_maps_redirect_to_http_error_and_never_follows_it() {
        // Policy::none() ⇒ the 3xx comes back untouched and is mapped to `http`.
        let response =
            "HTTP/1.1 302 Found\r\nLocation: http://evil.invalid/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string();
        let (base, server) = serve(response);
        let err = super::ai_chat(local_request(&base)).expect_err("302");
        assert!(matches!(err, AiError::Http(_)), "{err:?}");
        server.join().expect("server thread");
    }

    #[test]
    fn ai_chat_maps_garbage_200_body_to_invalid_response() {
        let body = "<html>definitely not json</html>";
        let (base, server) = serve(response_with_body(200, "OK", "text/html", body));
        let err = super::ai_chat(local_request(&base)).expect_err("garbage");
        assert!(matches!(err, AiError::InvalidResponse(_)), "{err:?}");
        server.join().expect("server thread");
    }

    #[test]
    fn ai_chat_rejects_declared_oversize_before_reading_body() {
        // Huge Content-Length ⇒ fast-path rejection without transferring it.
        let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 999999999\r\nConnection: close\r\n\r\n{}".to_string();
        let (base, server) = serve(response);
        let err = super::ai_chat(local_request(&base)).expect_err("oversized");
        assert!(matches!(err, AiError::InvalidResponse(_)), "{err:?}");
        server.join().expect("server thread");
    }

    #[test]
    fn ai_chat_aborts_oversized_streamed_body_mid_flight() {
        // No Content-Length ⇒ body streams until EOF; the server pushes past
        // the cap and the client must abort WITHOUT buffering it all.
        let head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n";
        let oversize = format!("{head}{}", "[".repeat(MAX_BODY_BYTES as usize + 64 * 1024));
        let (base, server) = serve(oversize);
        let err = super::ai_chat(local_request(&base)).expect_err("oversized stream");
        assert!(matches!(err, AiError::InvalidResponse(_)), "{err:?}");
        // The server may hit EPIPE once we drop the socket — either way it ends.
        let _ = server.join();
    }
}
