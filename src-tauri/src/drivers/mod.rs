//! Data sources. Each one implements [`Driver`] plus the trait for its kind of
//! store ([`KeyValueDriver`] today); Tauri commands only ever talk to the traits,
//! so adding a database means adding a module here, not changing the commands.

pub mod redis;

use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;

use crate::error::AppError;

/// What the UI shows about the current connection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub driver: String,
    pub address: String,
    pub database: i64,
    /// Which screen the UI shows: `"keyValue"` for Redis and friends.
    pub store: String,
}

/// One step of browsing. `cursor` is opaque to the caller: pass back what the
/// previous page returned. It is a string because Redis cursors are 64-bit.
#[derive(Debug, Clone, Default)]
pub struct BrowseQuery {
    pub pattern: Option<String>,
    pub cursor: Option<String>,
    pub count: u32,
    /// Only keys of this type (`string`, `hash`, `list`, `set`, `zset` or `stream`).
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    /// `None` when there is nothing more to load.
    pub next_cursor: Option<String>,
}

/// One entry in the browse tree.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub name: String,
    pub kind: String,
    /// Seconds until expiry; `None` when the key never expires.
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapEntry {
    pub key: String,
    pub value: String,
}

/// What the UI knows how to render. A Redis hash and a SQL row can both
/// arrive as `Map` or `Table`, so the viewers are written once.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Value {
    Text {
        text: String,
        truncated: bool,
    },
    Binary {
        hex: String,
        length: u64,
        truncated: bool,
    },
    Map {
        entries: Vec<MapEntry>,
        total: u64,
        truncated: bool,
    },
    List {
        items: Vec<String>,
        total: u64,
        truncated: bool,
    },
    Table {
        columns: Vec<String>,
        rows: Vec<Vec<String>>,
        total: u64,
        truncated: bool,
    },
    Stream {
        /// Newest first.
        entries: Vec<StreamEntry>,
        total: u64,
        /// Pass to `stream_page` for older entries; `None` at the start of the stream.
        next_before: Option<String>,
        groups: Vec<StreamGroup>,
    },
    Unsupported {
        kind: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEntry {
    pub id: String,
    /// Milliseconds since the epoch, taken from the ID. Custom IDs may not carry one.
    pub time_ms: Option<u64>,
    pub fields: Vec<MapEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamGroup {
    pub name: String,
    pub consumers: i64,
    /// Messages delivered but not yet acknowledged.
    pub pending: i64,
    pub last_delivered_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamPage {
    pub entries: Vec<StreamEntry>,
    pub next_before: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub name: String,
    pub kind: String,
    pub ttl_seconds: Option<i64>,
    pub encoding: Option<String>,
    pub size_bytes: Option<u64>,
    pub value: Value,
    /// The exact commands used, shown in the UI so reads are never a mystery.
    pub read_with: Vec<String>,
}

/// One database's slice of the keyspace.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub index: u32,
    pub keys: u64,
    pub expires: u64,
}

/// A snapshot of server health. Every field a server might not report is optional.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub product: String,
    pub version: String,
    pub mode: Option<String>,
    pub role: Option<String>,
    pub os: Option<String>,
    pub uptime_seconds: Option<u64>,
    pub used_memory: Option<u64>,
    /// 0 means no limit.
    pub max_memory: Option<u64>,
    pub connected_clients: Option<u64>,
    pub ops_per_sec: Option<u64>,
    pub hits: Option<u64>,
    pub misses: Option<u64>,
    /// Databases that hold keys.
    pub databases: Vec<DatabaseInfo>,
    /// How many databases the server has, or `None` when it won't say
    /// (managed services often block CONFIG).
    pub database_count: Option<u32>,
}

/// What a server says about itself when first contacted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// Detected product, such as "Redis", "Valkey" or "Dragonfly".
    pub product: String,
    pub version: String,
    pub key_count: u64,
}

/// What every data store can do: say what it is and answer a first hello.
#[async_trait]
pub trait Driver: Send + Sync {
    fn describe(&self) -> ConnectionInfo;
    async fn probe(&self) -> Result<Probe, AppError>;
}

/// A connected driver, by the kind of store it is. Commands ask for the kind they
/// need, so a Redis command on another kind of connection fails with a clear message.
#[derive(Clone)]
pub enum Store {
    KeyValue(Arc<dyn KeyValueDriver>),
}

impl Store {
    pub fn driver(&self) -> &dyn Driver {
        match self {
            Store::KeyValue(d) => d.as_ref(),
        }
    }
}

/// Stores browsed as a tree of keys (Redis, Valkey, Dragonfly).
#[async_trait]
pub trait KeyValueDriver: Driver {
    async fn server_info(&self) -> Result<ServerInfo, AppError>;
    async fn browse(&self, query: BrowseQuery) -> Result<Page<Node>, AppError>;
    async fn read(&self, name: &str) -> Result<Detail, AppError>;
    /// Older entries of a stream, newest first, strictly before `before`.
    async fn stream_page(
        &self,
        name: &str,
        before: &str,
        count: u32,
    ) -> Result<StreamPage, AppError>;
}
