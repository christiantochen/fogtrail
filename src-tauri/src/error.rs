use serde::Serialize;
use serde::Serializer;
use serde::ser::SerializeStruct;

/// Every error the UI can see. It crosses the IPC boundary as
/// `{ "kind": "...", "message": "..." }` so the frontend can show it cleanly.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Connect(String),
    #[error("Key not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    InvalidArgument(String),
    #[error("Not connected. Pick a connection first.")]
    NotConnected,
    #[error("Could not read or write saved connections: {0}")]
    Storage(String),
    #[error("Keychain error: {0}")]
    Secret(String),
    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),
    /// The SQL server refused or failed a statement. The message is the server's own.
    #[error("{0}")]
    Sql(String),
    /// The query editor refused a statement before it was sent (see `sql_guard`).
    #[error("{0}")]
    Blocked(String),
}

impl AppError {
    fn kind(&self) -> &'static str {
        match self {
            AppError::Connect(_) => "connect",
            AppError::NotFound(_) => "notFound",
            AppError::InvalidArgument(_) => "invalidArgument",
            AppError::NotConnected => "notConnected",
            AppError::Storage(_) => "storage",
            AppError::Secret(_) => "secret",
            AppError::Redis(_) => "redis",
            AppError::Sql(_) => "sql",
            AppError::Blocked(_) => "blocked",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut out = serializer.serialize_struct("AppError", 2)?;
        out.serialize_field("kind", self.kind())?;
        out.serialize_field("message", &self.to_string())?;
        out.end()
    }
}
