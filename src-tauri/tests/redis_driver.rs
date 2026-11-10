//! Runs against a real server. Set `FOGTRAIL_TEST_REDIS_URL` (for example
//! `redis://127.0.0.1:6379/15`); without it the tests skip. The target database
//! is flushed, so point it at a throwaway one.

use fogtrail_lib::drivers::redis::RedisDriver;
use fogtrail_lib::drivers::{BrowseQuery, Driver, KeyValueDriver, Value};
use fogtrail_lib::error::AppError;

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Tests share one database, so each holds this guard for its whole run.
async fn seeded() -> Option<(tokio::sync::MutexGuard<'static, ()>, RedisDriver)> {
    let guard = LOCK.lock().await;
    let url = std::env::var("FOGTRAIL_TEST_REDIS_URL").ok()?;
    let client = redis::Client::open(url.as_str()).unwrap();
    let mut conn = client.get_multiplexed_async_connection().await.unwrap();
    let _: () = redis::cmd("FLUSHDB").query_async(&mut conn).await.unwrap();
    let mut pipe = redis::pipe();
    pipe.cmd("SET")
        .arg("greeting")
        .arg("hello")
        .cmd("SET")
        .arg("session:a")
        .arg("x")
        .arg("EX")
        .arg(3600)
        .cmd("SET")
        .arg("bin")
        .arg(&[0xffu8, 0xfe, 0x00][..])
        .cmd("HSET")
        .arg("user:1")
        .arg("name")
        .arg("Ada")
        .arg("plan")
        .arg("pro")
        .cmd("RPUSH")
        .arg("queue")
        .arg("a")
        .arg("b")
        .arg("c")
        .cmd("SADD")
        .arg("tags")
        .arg("x")
        .arg("y")
        .cmd("ZADD")
        .arg("board")
        .arg(2)
        .arg("ada")
        .arg(1)
        .arg("grace")
        .cmd("XADD")
        .arg("events")
        .arg("1000-0")
        .arg("type")
        .arg("signup")
        .cmd("XADD")
        .arg("events")
        .arg("1000-1")
        .arg("type")
        .arg("login")
        .cmd("XADD")
        .arg("events")
        .arg("2000-0")
        .arg("type")
        .arg("signup")
        .cmd("XGROUP")
        .arg("CREATE")
        .arg("events")
        .arg("workers")
        .arg("0")
        .cmd("XREADGROUP")
        .arg("GROUP")
        .arg("workers")
        .arg("c1")
        .arg("COUNT")
        .arg(1)
        .arg("STREAMS")
        .arg("events")
        .arg(">");
    let _: () = pipe.query_async(&mut conn).await.unwrap();
    Some((guard, RedisDriver::new(url)))
}

fn all(count: u32) -> BrowseQuery {
    BrowseQuery {
        count,
        ..Default::default()
    }
}

#[tokio::test]
async fn browse_lists_keys_with_type_and_ttl() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };
    let mut page = d.browse(all(1000)).await.unwrap();
    assert!(page.next_cursor.is_none());
    page.items.sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(page.items.len(), 8);
    let session = page.items.iter().find(|n| n.name == "session:a").unwrap();
    assert_eq!(session.kind, "string");
    assert!(session.ttl_seconds.unwrap() > 3500);
    let greeting = page.items.iter().find(|n| n.name == "greeting").unwrap();
    assert_eq!(greeting.ttl_seconds, None);
}

#[tokio::test]
async fn browse_can_filter_by_type() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };
    let page = d
        .browse(BrowseQuery {
            count: 1000,
            kind: Some("hash".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(!page.items.is_empty());
    assert!(page.items.iter().all(|n| n.kind == "hash"));
    assert!(page.items.iter().any(|n| n.name == "user:1"));

    let err = d
        .browse(BrowseQuery {
            count: 10,
            kind: Some("hash COUNT 1".into()),
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidArgument(_)));
}

#[tokio::test]
async fn browse_filters_by_pattern_and_pages_with_cursor() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };
    let page = d
        .browse(BrowseQuery {
            pattern: Some("user:*".into()),
            count: 1000,
            cursor: None,
            kind: None,
        })
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);

    // Tiny COUNT forces multiple round trips; following cursors finds everything.
    let mut seen = 0;
    let mut cursor = None;
    for _ in 0..1000 {
        let page = d
            .browse(BrowseQuery {
                count: 10,
                cursor: cursor.clone(),
                pattern: None,
                kind: None,
            })
            .await
            .unwrap();
        seen += page.items.len();
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    assert_eq!(seen, 8);
}

#[tokio::test]
async fn browse_rejects_bad_cursor() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };
    let err = d
        .browse(BrowseQuery {
            cursor: Some("nope".into()),
            count: 10,
            pattern: None,
            kind: None,
        })
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidArgument(_)));
}

#[tokio::test]
async fn reads_every_supported_type() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };

    let s = d.read("greeting").await.unwrap();
    assert!(matches!(s.value, Value::Text { ref text, truncated: false } if text == "hello"));
    assert_eq!(s.kind, "string");

    let h = d.read("user:1").await.unwrap();
    match h.value {
        Value::Map { entries, total, .. } => {
            assert_eq!(total, 2);
            assert_eq!(entries[0].key, "name");
            assert_eq!(entries[0].value, "Ada");
        }
        other => panic!("expected map, got {other:?}"),
    }

    let l = d.read("queue").await.unwrap();
    assert!(
        matches!(l.value, Value::List { ref items, total: 3, .. } if items == &["a", "b", "c"])
    );

    let st = d.read("tags").await.unwrap();
    assert!(matches!(st.value, Value::List { ref items, total: 2, .. } if items == &["x", "y"]));

    let z = d.read("board").await.unwrap();
    match z.value {
        Value::Table { rows, total, .. } => {
            assert_eq!(total, 2);
            assert_eq!(rows[0], vec!["grace", "1"]);
        }
        other => panic!("expected table, got {other:?}"),
    }

    let e = d.read("events").await.unwrap();
    match e.value {
        Value::Stream {
            entries,
            total,
            next_before,
            groups,
        } => {
            assert_eq!(total, 3);
            let ids: Vec<_> = entries.iter().map(|e| e.id.as_str()).collect();
            assert_eq!(ids, ["2000-0", "1000-1", "1000-0"]);
            assert_eq!(entries[0].time_ms, Some(2000));
            assert_eq!(entries[0].fields[0].key, "type");
            assert_eq!(next_before, None);
            assert_eq!(groups.len(), 1);
            assert_eq!(groups[0].name, "workers");
            assert_eq!(groups[0].pending, 1);
        }
        other => panic!("expected stream, got {other:?}"),
    }
}

#[tokio::test]
async fn binary_strings_come_back_as_hex() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };
    let b = d.read("bin").await.unwrap();
    assert!(matches!(b.value, Value::Binary { ref hex, length: 3, .. } if hex == "fffe00"));
}

#[tokio::test]
async fn missing_key_is_not_found() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };
    assert!(matches!(
        d.read("nope").await.unwrap_err(),
        AppError::NotFound(_)
    ));
}

#[tokio::test]
async fn unreachable_server_gives_a_clean_connect_error() {
    let d = RedisDriver::new("redis://127.0.0.1:1");
    let err = d.browse(all(10)).await.unwrap_err();
    assert!(matches!(err, AppError::Connect(_)));
    assert!(err.to_string().contains("127.0.0.1:1"));
}

#[tokio::test]
async fn probe_reports_product_and_key_count() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };
    let p = d.probe().await.unwrap();
    assert_eq!(p.product, "Redis");
    assert_eq!(p.key_count, 8);
    assert!(!p.version.is_empty());
}

#[tokio::test]
async fn stream_pages_walk_back_without_gaps_or_repeats() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };
    let first = d.stream_page("events", "9999-0", 2).await.unwrap();
    let ids: Vec<_> = first.entries.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, ["2000-0", "1000-1"]);
    assert_eq!(first.next_before.as_deref(), Some("1000-1"));

    let second = d.stream_page("events", "1000-1", 2).await.unwrap();
    let ids: Vec<_> = second.entries.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, ["1000-0"]);
    assert_eq!(second.next_before, None);

    let err = d.stream_page("events", "garbage", 2).await.unwrap_err();
    assert!(matches!(err, AppError::InvalidArgument(_)));
}

#[tokio::test]
async fn server_info_reports_health_and_keyspace() {
    let Some((_guard, d)) = seeded().await else {
        return;
    };
    let info = d.server_info().await.unwrap();
    assert_eq!(info.product, "Redis");
    assert!(info.uptime_seconds.is_some());
    assert!(info.used_memory.unwrap() > 0);
    assert!(info.connected_clients.unwrap() >= 1);
    let db15 = info.databases.iter().find(|d| d.index == 15).unwrap();
    assert_eq!(db15.keys, 8);
    assert_eq!(db15.expires, 1);
    // The seed uses db15, so the server has at least 16.
    assert!(info.database_count.unwrap() >= 16);
}

#[tokio::test]
async fn switching_database_changes_what_you_browse() {
    use fogtrail_lib::connections::Connections;
    use fogtrail_lib::profiles::{Profile, ProfileStore};
    use fogtrail_lib::secrets::MemoryStore;

    let Some((_guard, _d)) = seeded().await else {
        return;
    };
    let url = std::env::var("FOGTRAIL_TEST_REDIS_URL").unwrap();
    let hostport = url
        .trim_start_matches("redis://")
        .split('/')
        .next()
        .unwrap();
    let (host, port) = hostport.rsplit_once(':').unwrap();
    let dir = std::env::temp_dir().join(format!("fogtrail-it-{}", std::process::id()));
    let conns = Connections::new(
        ProfileStore::new(dir.join("c.json")),
        Box::new(MemoryStore::default()),
    );
    let saved = conns
        .save(
            Profile {
                id: String::new(),
                name: "it".into(),
                driver: "redis".into(),
                host: host.into(),
                port: port.parse().unwrap(),
                username: None,
                database: 15,
                schema: None,
                tls: false,
            },
            None,
        )
        .unwrap();

    let info = conns.connect(&saved.id).await.unwrap();
    assert_eq!(info.database, 15);
    let seeded_keys = conns.key_value().unwrap().browse(all(1000)).await.unwrap();
    assert_eq!(seeded_keys.items.len(), 8);

    let info = conns.select_database(14).await.unwrap();
    assert_eq!(info.database, 14);
    let empty = conns.key_value().unwrap().browse(all(1000)).await.unwrap();
    assert!(empty.items.is_empty());
    // The saved profile still points at db 15.
    assert_eq!(conns.list().unwrap()[0].database, 15);
    let _ = std::fs::remove_dir_all(dir);
}
