//! Error taxonomy (§5.7). Every failure a user can hit maps onto one of three
//! kinds so the toast layer can phrase it correctly: `User` (their input, no
//! log spam), `Engine` (a sidecar failed — toast + stderr tail to log),
//! `System` (fs/permissions — actionable message).

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Bad input or a user-initiated cancel — friendly toast, not logged as an error.
    #[error("{0}")]
    User(String),

    /// A sidecar exited non-zero. `stderr_tail` is the §5.2 ring buffer content.
    #[error("{context}")]
    Engine {
        context: String,
        stderr_tail: String,
    },

    /// Filesystem/permission/OS trouble the user can act on.
    #[error("{0}")]
    System(String),
}

impl AppError {
    pub fn user(msg: impl Into<String>) -> Self {
        AppError::User(msg.into())
    }

    pub fn system(msg: impl Into<String>) -> Self {
        AppError::System(msg.into())
    }
}

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::System(err.to_string())
    }
}

/// Commands cross the IPC boundary as this serializable shape.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPayload {
    pub kind: &'static str,
    pub message: String,
}

impl From<&AppError> for ErrorPayload {
    fn from(err: &AppError) -> Self {
        let kind = match err {
            AppError::User(_) => "user",
            AppError::Engine { .. } => "engine",
            AppError::System(_) => "system",
        };
        ErrorPayload {
            kind,
            message: err.to_string(),
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ErrorPayload::from(self).serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
