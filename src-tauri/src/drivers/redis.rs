//! Redis driver. Also speaks to Valkey, Dragonfly, KeyDB and friends, since they
//! share the protocol. Everything here is read-only: the only commands sent are
//! SCAN-family, TYPE, TTL, OBJECT, MEMORY USAGE, CONFIG GET databases and the
//! plain readers.

use async_trait::async_trait;
use std::time::Duration;

use redis::aio::{ConnectionManager, ConnectionManagerConfig};
use tokio::sync::OnceCell;

use super::{
    BrowseQuery, ConnectionInfo, DatabaseInfo, Detail, Driver, MapEntry, Node, Page, Probe,
    ServerInfo, StreamEntry, StreamGroup, StreamPage, Value,
};
use crate::error::AppError;

/// Most items a collection read will return. Keeps huge keys from freezing the UI.
const ITEM_LIMIT: usize = 500;
/// Most bytes of a string value that will be fetched.
const BYTE_LIMIT: usize = 1024 * 1024;
/// Most bytes of a binary value that will be rendered as hex.
const HEX_LIMIT: usize = 4096;
/// Entries per stream page, and the most a caller may ask for.
const STREAM_PAGE: usize = 100;
const STREAM_PAGE_MAX: usize = 500;
/// Hard ceiling on SCAN COUNT, whatever the caller asks for.
const MAX_SCAN_COUNT: u32 = 1000;

pub struct RedisDriver {
    url: String,
    conn: OnceCell<ConnectionManager>,
}

impl RedisDriver {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            conn: OnceCell::new(),
        }
    }

    /// Connects on first use, then hands out cheap clones of the manager, which
    /// reconnects by itself if the server goes away.
    async fn connection(&self) -> Result<ConnectionManager, AppError> {
        let manager = self
            .conn
            .get_or_try_init(|| async {
                let client = redis::Client::open(self.url.as_str())
                    .map_err(|e| AppError::Connect(format!("Invalid connection URL: {e}")))?;
                // Fail fast: a wrong host should show an error in seconds, not
                // after the default exponential backoff.
                let config = ConnectionManagerConfig::new()
                    .set_number_of_retries(1)
                    .set_connection_timeout(Some(Duration::from_secs(3)))
                    .set_response_timeout(Some(Duration::from_secs(15)));
                ConnectionManager::new_with_config(client, config)
                    .await
                    .map_err(|e| {
                        AppError::Connect(format!("Could not connect to {}: {e}", self.address()))
                    })
            })
            .await?;
        Ok(manager.clone())
    }

    fn parsed(&self) -> Option<redis::ConnectionInfo> {
        redis::IntoConnectionInfo::into_connection_info(self.url.as_str()).ok()
    }

    fn address(&self) -> String {
        match self.parsed().map(|i| i.addr().to_string()) {
            Some(addr) => addr,
            None => "unknown".to_string(),
        }
    }
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn ttl_from(raw: i64) -> Option<i64> {
    (raw >= 0).then_some(raw)
}

fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// Picks the product out of `INFO server`. Valkey and Dragonfly both keep
/// reporting a Redis-compatible `redis_version`, so their own fields win.
pub fn detect(info: &str) -> (String, String) {
    let field = |name: &str| {
        info.lines()
            .find_map(|l| l.strip_prefix(name).and_then(|r| r.strip_prefix(':')))
            .map(|v| v.trim().to_string())
    };
    if let Some(v) = field("dragonfly_version") {
        return ("Dragonfly".into(), v.trim_start_matches('v').into());
    }
    if let Some(v) = field("valkey_version") {
        return ("Valkey".into(), v);
    }
    if field("keydb_version").is_some() || info.contains("server_name:keydb") {
        return ("KeyDB".into(), field("redis_version").unwrap_or_default());
    }
    ("Redis".into(), field("redis_version").unwrap_or_default())
}

/// `INFO` output as `name -> value`, skipping section headers and blank lines.
pub fn parse_info(info: &str) -> std::collections::HashMap<String, String> {
    info.lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| l.trim().split_once(':'))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// `db0:keys=16,expires=3,avg_ttl=0` lines, for databases that hold keys.
pub fn parse_keyspace(fields: &std::collections::HashMap<String, String>) -> Vec<DatabaseInfo> {
    let mut dbs: Vec<DatabaseInfo> = fields
        .iter()
        .filter_map(|(k, v)| {
            let index = k.strip_prefix("db")?.parse().ok()?;
            let part = |name: &str| {
                v.split(',')
                    .find_map(|kv| kv.strip_prefix(name)?.strip_prefix('='))
                    .and_then(|n| n.parse().ok())
                    .unwrap_or(0)
            };
            Some(DatabaseInfo {
                index,
                keys: part("keys"),
                expires: part("expires"),
            })
        })
        .collect();
    dbs.sort_by_key(|d| d.index);
    dbs
}

/// The reply to `CONFIG GET databases` is `["databases", "16"]`.
pub fn parse_database_count(reply: &[String]) -> Option<u32> {
    match reply {
        [name, value, ..] if name.eq_ignore_ascii_case("databases") => {
            value.trim().parse().ok().filter(|n| *n > 0)
        }
        _ => None,
    }
}

#[async_trait]
impl Driver for RedisDriver {
    async fn server_info(&self) -> Result<ServerInfo, AppError> {
        let mut conn = self.connection().await?;
        let raw: String = redis::cmd("INFO").query_async(&mut conn).await?;
        let f = parse_info(&raw);
        let num = |k: &str| f.get(k).and_then(|v| v.trim().parse::<u64>().ok());
        let text = |k: &str| {
            f.get(k)
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        };
        let (product, version) = detect(&raw);
        // Read-only, but managed services often refuse CONFIG, so a refusal just means "unknown".
        let config: Result<Vec<String>, _> = redis::cmd("CONFIG")
            .arg("GET")
            .arg("databases")
            .query_async(&mut conn)
            .await;
        let database_count = config.ok().and_then(|r| parse_database_count(&r));
        Ok(ServerInfo {
            product,
            version,
            mode: text("redis_mode"),
            role: text("role"),
            os: text("os"),
            uptime_seconds: num("uptime_in_seconds"),
            used_memory: num("used_memory"),
            max_memory: num("maxmemory"),
            connected_clients: num("connected_clients"),
            ops_per_sec: num("instantaneous_ops_per_sec"),
            hits: num("keyspace_hits"),
            misses: num("keyspace_misses"),
            databases: parse_keyspace(&f),
            database_count,
        })
    }

    async fn probe(&self) -> Result<Probe, AppError> {
        let mut conn = self.connection().await?;
        let info: String = redis::cmd("INFO")
            .arg("server")
            .query_async(&mut conn)
            .await?;
        let key_count: u64 = redis::cmd("DBSIZE").query_async(&mut conn).await?;
        let (product, version) = detect(&info);
        Ok(Probe {
            product,
            version,
            key_count,
        })
    }

    fn describe(&self) -> ConnectionInfo {
        ConnectionInfo {
            driver: "Redis".to_string(),
            address: self.address(),
            database: self.parsed().map_or(0, |i| i.redis_settings().db()),
        }
    }

    async fn browse(&self, query: BrowseQuery) -> Result<Page<Node>, AppError> {
        let mut conn = self.connection().await?;
        let cursor = query.cursor.unwrap_or_else(|| "0".to_string());
        if cursor.parse::<u64>().is_err() {
            return Err(AppError::InvalidArgument(format!("Bad cursor: {cursor}")));
        }
        let count = query.count.clamp(10, MAX_SCAN_COUNT);

        let mut scan = redis::cmd("SCAN");
        scan.arg(&cursor);
        if let Some(pattern) = query.pattern.as_deref().filter(|p| !p.is_empty()) {
            scan.arg("MATCH").arg(pattern);
        }
        scan.arg("COUNT").arg(count);
        let (next, keys): (String, Vec<Vec<u8>>) = scan.query_async(&mut conn).await?;

        let mut items = Vec::with_capacity(keys.len());
        if !keys.is_empty() {
            let mut types = redis::pipe();
            let mut ttls = redis::pipe();
            for key in &keys {
                types.cmd("TYPE").arg(key.as_slice());
                ttls.cmd("TTL").arg(key.as_slice());
            }
            let types: Vec<String> = types.query_async(&mut conn).await?;
            let ttls: Vec<i64> = ttls.query_async(&mut conn).await?;
            for ((key, kind), ttl) in keys.iter().zip(types).zip(ttls) {
                // "none" means the key expired between SCAN and TYPE.
                if kind == "none" {
                    continue;
                }
                items.push(Node {
                    name: lossy(key),
                    kind,
                    ttl_seconds: ttl_from(ttl),
                });
            }
        }

        Ok(Page {
            items,
            next_cursor: (next != "0").then_some(next),
        })
    }

    async fn stream_page(
        &self,
        name: &str,
        before: &str,
        count: u32,
    ) -> Result<StreamPage, AppError> {
        let mut conn = self.connection().await?;
        let count = (count as usize).clamp(1, STREAM_PAGE_MAX);
        let end = decrement_id(before)
            .ok_or_else(|| AppError::InvalidArgument(format!("Bad stream ID: {before}")))?;
        let (entries, next_before) = fetch_stream(&mut conn, name.as_bytes(), &end, count).await?;
        Ok(StreamPage {
            entries,
            next_before,
        })
    }

    async fn read(&self, name: &str) -> Result<Detail, AppError> {
        let mut conn = self.connection().await?;
        let key = name.as_bytes();

        let kind: String = redis::cmd("TYPE").arg(key).query_async(&mut conn).await?;
        if kind == "none" {
            return Err(AppError::NotFound(name.to_string()));
        }
        let ttl: i64 = redis::cmd("TTL").arg(key).query_async(&mut conn).await?;
        let encoding: Option<String> = redis::cmd("OBJECT")
            .arg("ENCODING")
            .arg(key)
            .query_async(&mut conn)
            .await
            .unwrap_or(None);
        // MEMORY USAGE is denied by some ACLs and unsupported by some servers.
        let size_bytes: Option<u64> = redis::cmd("MEMORY")
            .arg("USAGE")
            .arg(key)
            .query_async(&mut conn)
            .await
            .unwrap_or(None);

        let (value, read_with) = match kind.as_str() {
            "string" => read_string(&mut conn, name, key).await?,
            "hash" => read_hash(&mut conn, name, key).await?,
            "list" => read_list(&mut conn, name, key).await?,
            "set" => read_set(&mut conn, name, key).await?,
            "zset" => read_zset(&mut conn, name, key).await?,
            "stream" => read_stream(&mut conn, name, key).await?,
            other => (
                Value::Unsupported {
                    kind: other.to_string(),
                },
                vec![format!("TYPE {name}")],
            ),
        };

        Ok(Detail {
            name: name.to_string(),
            kind,
            ttl_seconds: ttl_from(ttl),
            encoding,
            size_bytes,
            value,
            read_with,
        })
    }
}

type Read = Result<(Value, Vec<String>), AppError>;

async fn read_string(conn: &mut ConnectionManager, name: &str, key: &[u8]) -> Read {
    let len: usize = redis::cmd("STRLEN").arg(key).query_async(conn).await?;
    let truncated = len > BYTE_LIMIT;
    let (bytes, command): (Vec<u8>, String) = if truncated {
        let bytes = redis::cmd("GETRANGE")
            .arg(key)
            .arg(0)
            .arg(BYTE_LIMIT - 1)
            .query_async(conn)
            .await?;
        (bytes, format!("GETRANGE {name} 0 {}", BYTE_LIMIT - 1))
    } else {
        (
            redis::cmd("GET").arg(key).query_async(conn).await?,
            format!("GET {name}"),
        )
    };

    let value = match String::from_utf8(bytes) {
        Ok(text) => Value::Text { text, truncated },
        Err(err) => {
            let bytes = err.into_bytes();
            Value::Binary {
                hex: hex(&bytes[..bytes.len().min(HEX_LIMIT)]),
                length: len as u64,
                truncated: bytes.len() > HEX_LIMIT || truncated,
            }
        }
    };
    Ok((value, vec![format!("STRLEN {name}"), command]))
}

async fn read_hash(conn: &mut ConnectionManager, name: &str, key: &[u8]) -> Read {
    let total: u64 = redis::cmd("HLEN").arg(key).query_async(conn).await?;
    let mut entries = Vec::new();
    let mut cursor = "0".to_string();
    loop {
        let (next, flat): (String, Vec<Vec<u8>>) = redis::cmd("HSCAN")
            .arg(key)
            .arg(&cursor)
            .arg("COUNT")
            .arg(ITEM_LIMIT)
            .query_async(conn)
            .await?;
        for pair in flat.chunks_exact(2) {
            entries.push(MapEntry {
                key: lossy(&pair[0]),
                value: lossy(&pair[1]),
            });
        }
        cursor = next;
        if cursor == "0" || entries.len() >= ITEM_LIMIT {
            break;
        }
    }
    let truncated = (entries.len() as u64) < total;
    entries.truncate(ITEM_LIMIT);
    entries.sort_by(|a, b| a.key.cmp(&b.key));
    Ok((
        Value::Map {
            entries,
            total,
            truncated,
        },
        vec![
            format!("HLEN {name}"),
            format!("HSCAN {name} 0 COUNT {ITEM_LIMIT}"),
        ],
    ))
}

async fn read_list(conn: &mut ConnectionManager, name: &str, key: &[u8]) -> Read {
    let total: u64 = redis::cmd("LLEN").arg(key).query_async(conn).await?;
    let raw: Vec<Vec<u8>> = redis::cmd("LRANGE")
        .arg(key)
        .arg(0)
        .arg(ITEM_LIMIT - 1)
        .query_async(conn)
        .await?;
    let items: Vec<String> = raw.iter().map(|b| lossy(b)).collect();
    Ok((
        Value::List {
            truncated: (items.len() as u64) < total,
            items,
            total,
        },
        vec![
            format!("LLEN {name}"),
            format!("LRANGE {name} 0 {}", ITEM_LIMIT - 1),
        ],
    ))
}

async fn read_set(conn: &mut ConnectionManager, name: &str, key: &[u8]) -> Read {
    let total: u64 = redis::cmd("SCARD").arg(key).query_async(conn).await?;
    let mut items: Vec<String> = Vec::new();
    let mut cursor = "0".to_string();
    loop {
        let (next, batch): (String, Vec<Vec<u8>>) = redis::cmd("SSCAN")
            .arg(key)
            .arg(&cursor)
            .arg("COUNT")
            .arg(ITEM_LIMIT)
            .query_async(conn)
            .await?;
        items.extend(batch.iter().map(|b| lossy(b)));
        cursor = next;
        if cursor == "0" || items.len() >= ITEM_LIMIT {
            break;
        }
    }
    // SSCAN may return duplicates; a set has none.
    items.sort();
    items.dedup();
    let truncated = (items.len() as u64) < total;
    items.truncate(ITEM_LIMIT);
    Ok((
        Value::List {
            items,
            total,
            truncated,
        },
        vec![
            format!("SCARD {name}"),
            format!("SSCAN {name} 0 COUNT {ITEM_LIMIT}"),
        ],
    ))
}

async fn read_zset(conn: &mut ConnectionManager, name: &str, key: &[u8]) -> Read {
    let total: u64 = redis::cmd("ZCARD").arg(key).query_async(conn).await?;
    let raw: Vec<(Vec<u8>, String)> = redis::cmd("ZRANGE")
        .arg(key)
        .arg(0)
        .arg(ITEM_LIMIT - 1)
        .arg("WITHSCORES")
        .query_async(conn)
        .await?;
    let rows: Vec<Vec<String>> = raw
        .into_iter()
        .map(|(member, score)| vec![lossy(&member), score])
        .collect();
    Ok((
        Value::Table {
            columns: vec!["member".to_string(), "score".to_string()],
            truncated: (rows.len() as u64) < total,
            rows,
            total,
        },
        vec![
            format!("ZCARD {name}"),
            format!("ZRANGE {name} 0 {} WITHSCORES", ITEM_LIMIT - 1),
        ],
    ))
}

/// The ID just before `id`, as an inclusive upper bound for XREVRANGE. Avoids the
/// `(id` exclusive syntax, which older servers lack. `None` if `id` is invalid or `0-0`.
pub fn decrement_id(id: &str) -> Option<String> {
    let (ms, seq) = match id.split_once('-') {
        Some((ms, seq)) => (ms.parse::<u64>().ok()?, seq.parse::<u64>().ok()?),
        None => (id.parse::<u64>().ok()?, 0),
    };
    match (ms, seq) {
        (0, 0) => None,
        (ms, 0) => Some(format!("{}-{}", ms - 1, u64::MAX)),
        (ms, seq) => Some(format!("{ms}-{}", seq - 1)),
    }
}

fn time_of(id: &str) -> Option<u64> {
    id.split('-').next()?.parse().ok()
}

/// Fetches up to `count` entries at or before `end`, and the ID to continue from.
async fn fetch_stream(
    conn: &mut ConnectionManager,
    key: &[u8],
    end: &str,
    count: usize,
) -> Result<(Vec<StreamEntry>, Option<String>), AppError> {
    // One extra row tells us whether there is anything older.
    let raw: Vec<(String, Vec<Vec<u8>>)> = redis::cmd("XREVRANGE")
        .arg(key)
        .arg(end)
        .arg("-")
        .arg("COUNT")
        .arg(count + 1)
        .query_async(conn)
        .await?;
    let more = raw.len() > count;
    let entries: Vec<StreamEntry> = raw
        .into_iter()
        .take(count)
        .map(|(id, flat)| StreamEntry {
            time_ms: time_of(&id),
            fields: flat
                .chunks_exact(2)
                .map(|p| MapEntry {
                    key: lossy(&p[0]),
                    value: lossy(&p[1]),
                })
                .collect(),
            id,
        })
        .collect();
    let next = if more {
        entries.last().map(|e| e.id.clone())
    } else {
        None
    };
    Ok((entries, next))
}

async fn read_stream(conn: &mut ConnectionManager, name: &str, key: &[u8]) -> Read {
    let total: u64 = redis::cmd("XLEN").arg(key).query_async(conn).await?;
    let (entries, next_before) = fetch_stream(conn, key, "+", STREAM_PAGE).await?;

    // Consumer groups are a bonus: an ACL may forbid XINFO, which shouldn't hide the entries.
    let raw: Vec<std::collections::HashMap<String, redis::Value>> = redis::cmd("XINFO")
        .arg("GROUPS")
        .arg(key)
        .query_async(conn)
        .await
        .unwrap_or_default();
    let text = |v: Option<&redis::Value>| match v {
        Some(redis::Value::BulkString(b)) => lossy(b),
        Some(redis::Value::SimpleString(s)) => s.clone(),
        _ => String::new(),
    };
    let number = |v: Option<&redis::Value>| match v {
        Some(redis::Value::Int(n)) => *n,
        _ => 0,
    };
    let groups = raw
        .iter()
        .map(|g| StreamGroup {
            name: text(g.get("name")),
            consumers: number(g.get("consumers")),
            pending: number(g.get("pending")),
            last_delivered_id: text(g.get("last-delivered-id")),
        })
        .collect();

    Ok((
        Value::Stream {
            entries,
            total,
            next_before,
            groups,
        },
        vec![
            format!("XLEN {name}"),
            format!("XREVRANGE {name} + - COUNT {STREAM_PAGE}"),
            format!("XINFO GROUPS {name}"),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use super::{decrement_id, detect, parse_database_count, parse_info, parse_keyspace};
    use crate::drivers::DatabaseInfo;

    #[test]
    fn parses_info_and_keyspace() {
        let raw = "# Server\r\nredis_version:7.0.15\r\nuptime_in_seconds:42\r\n\r\n# Keyspace\r\ndb0:keys=16,expires=3,avg_ttl=0\r\ndb15:keys=1,expires=0\r\n";
        let f = parse_info(raw);
        assert_eq!(f["uptime_in_seconds"], "42");
        assert_eq!(
            parse_keyspace(&f),
            vec![
                DatabaseInfo {
                    index: 0,
                    keys: 16,
                    expires: 3
                },
                DatabaseInfo {
                    index: 15,
                    keys: 1,
                    expires: 0
                },
            ]
        );
        // Not a database line, so ignored.
        assert!(parse_keyspace(&parse_info("dbsize:3\r\n")).is_empty());
    }

    #[test]
    fn reads_the_database_count() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(parse_database_count(&s(&["databases", "16"])), Some(16));
        assert_eq!(parse_database_count(&s(&["databases", "1"])), Some(1));
        assert_eq!(parse_database_count(&s(&["databases", "0"])), None);
        assert_eq!(parse_database_count(&s(&["databases", "x"])), None);
        assert_eq!(parse_database_count(&s(&["maxmemory", "0"])), None);
        assert_eq!(parse_database_count(&[]), None);
    }

    #[test]
    fn decrements_stream_ids() {
        assert_eq!(decrement_id("5-3").as_deref(), Some("5-2"));
        assert_eq!(
            decrement_id("5-0").as_deref(),
            Some("4-18446744073709551615")
        );
        assert_eq!(decrement_id("5").as_deref(), Some("4-18446744073709551615"));
        assert_eq!(decrement_id("0-0"), None);
        assert_eq!(decrement_id("nope"), None);
    }

    #[test]
    fn detects_products() {
        assert_eq!(
            detect("redis_version:7.2.4\r\nvalkey_version:8.0.1\r\n"),
            ("Valkey".into(), "8.0.1".into())
        );
        assert_eq!(
            detect("redis_version:6.2.5\r\ndragonfly_version:df-v1.21.0\r\n").0,
            "Dragonfly"
        );
        assert_eq!(
            detect("redis_version:7.0.15\r\n"),
            ("Redis".into(), "7.0.15".into())
        );
    }
}
