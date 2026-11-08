//! Backend error contract.
//!
//! Rust never owns user-facing wording. Every failure is reported as an
//! [`AppError`]: a stable machine-readable `code` plus an optional `detail`
//! carrying locale-neutral context (a task name, a folder path, an HRESULT in
//! hex). The frontend resolves `code` against the active language pack in
//! `src/lib/i18n` and inserts `detail` into the `{detail}` placeholder.
//!
//! Consequences worth knowing before adding a code:
//!
//! - A code is a public contract. Renaming one silently downgrades the UI to
//!   showing the raw code, so rename in Rust and in `en.js` / `zh.js` together.
//! - `detail` must stay locale-neutral. Anything a translator needs to reorder
//!   belongs in the copy, not here.
//! - `scripts/unit-js.mjs` asserts that every code referenced from the source
//!   tree exists in both packs; the build fails if they drift.

use serde::Serialize;

/// Result alias used across the backend.
pub type Result<T> = std::result::Result<T, AppError>;

/// Error handed to the frontend over IPC.
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    /// Stable dot-path identifier, e.g. `"com.folderNotFound"`.
    pub code: String,
    /// Locale-neutral context rendered into the copy as `{detail}`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl AppError {
    /// Attach locale-neutral context: `err("com.openFolder").with(path)`.
    pub fn with(mut self, detail: impl std::fmt::Display) -> Self {
        self.detail = Some(detail.to_string());
        self
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.detail {
            Some(d) => write!(f, "{} ({})", self.code, d),
            None => f.write_str(&self.code),
        }
    }
}

impl std::error::Error for AppError {}

/// Build an error with no context.
pub fn err(code: &str) -> AppError {
    AppError {
        code: code.to_string(),
        detail: None,
    }
}

/// Build an error carrying context.
pub fn errd(code: &str, detail: impl std::fmt::Display) -> AppError {
    err(code).with(detail)
}

/// Adapter for `Result<_, E>` combinators: `.map_err(map("export.write"))`.
pub fn map<E: std::fmt::Display>(code: &'static str) -> impl Fn(E) -> AppError {
    move |e| errd(code, e)
}
