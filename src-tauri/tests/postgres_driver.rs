//! Runs against a real PostgreSQL server seeded with `scripts/seed-postgres.sql`.
//! Set `FOGTRAIL_TEST_PG_URL` to the read-only user, for example
//! `postgres://fogtrail_ro:ro-test-pw@127.0.0.1:5432/shop`. Without it the tests skip.
//! Some tests also need `FOGTRAIL_TEST_PG_RW_URL` (the `fogtrail_rw` user) to prove
//! a user who can write still cannot through Fogtrail.

use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};

use fogtrail_lib::connections::Connections;
use fogtrail_lib::drivers::postgres::{self, PostgresDriver};
use fogtrail_lib::drivers::{Driver, QueryResult, RowView, SqlDriver};
use fogtrail_lib::error::AppError;
use fogtrail_lib::profiles::{Profile, ProfileStore};
use fogtrail_lib::secrets::MemoryStore;
use sqlx::postgres::PgConnectOptions;

fn url() -> Option<String> {
    std::env::var("FOGTRAIL_TEST_PG_URL").ok()
}

fn opts(url: &str) -> PgConnectOptions {
    // The throwaway test server has no TLS.
    PgConnectOptions::from_str(url)
        .unwrap()
        .ssl_mode(sqlx::postgres::PgSslMode::Disable)
}

fn driver() -> Option<PostgresDriver> {
    Some(PostgresDriver::new(opts(&url()?)))
}

/// Splits `postgres://user:pass@host:port/db` into a profile and its password.
fn profile_from(url: &str) -> (Profile, String) {
    let rest = url.strip_prefix("postgres://").unwrap();
    let (auth, addr) = rest.split_once('@').unwrap();
    let (user, pass) = auth.split_once(':').unwrap();
    let (hostport, db) = addr.split_once('/').unwrap();
    let (host, port) = hostport.split_once(':').unwrap();
    (
        Profile {
            id: String::new(),
            name: "it".into(),
            driver: "postgres".into(),
            host: host.into(),
            port: port.parse().unwrap(),
            username: Some(user.into()),
            database: 0,
            schema: None,
            tls: false,
            dbname: Some(db.into()),
            ssl_mode: Some("disable".into()),
        },
        pass.into(),
    )
}

macro_rules! driver_or_skip {
    () => {
        match driver() {
            Some(d) => d,
            None => return,
        }
    };
}

async fn run(d: &PostgresDriver, sql: &str) -> Result<QueryResult, AppError> {
    d.run_query(sql, None, "test").await
}

fn cells(r: &QueryResult) -> Vec<Vec<Option<&str>>> {
    r.rows
        .iter()
        .map(|row| row.iter().map(|c| c.as_deref()).collect())
        .collect()
}

#[tokio::test]
async fn probe_reports_product_and_version() {
    let d = driver_or_skip!();
    let p = d.probe().await.unwrap();
    assert_eq!(p.product, "PostgreSQL");
    assert!(p.version.chars().next().unwrap().is_ascii_digit());
    assert_eq!(p.key_count, None);
    assert_eq!(d.describe().store, "sql");
    assert_eq!(d.describe().driver, "PostgreSQL");
}

#[tokio::test]
async fn schemas_are_listed_and_system_ones_flagged() {
    let d = driver_or_skip!();
    let schemas = d.list_schemas().await.unwrap();
    for user in ["public", "billing"] {
        let s = schemas.iter().find(|s| s.name == user).unwrap();
        assert!(!s.system, "{user}");
    }
    for sys in ["pg_catalog", "information_schema"] {
        let s = schemas.iter().find(|s| s.name == sys).unwrap();
        assert!(s.system, "{sys}");
    }
}

#[tokio::test]
async fn tables_views_and_matviews_are_listed() {
    let d = driver_or_skip!();
    let tables = d.list_tables("public").await.unwrap();
    let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    for want in [
        "customers",
        "events",
        "orders",
        "paying_customers",
        "mv_plan_counts",
        "Weird Name",
    ] {
        assert!(names.contains(&want), "missing {want} in {names:?}");
    }
    let kind = |n: &str| tables.iter().find(|t| t.name == n).unwrap().kind.clone();
    assert_eq!(kind("paying_customers"), "view");
    assert_eq!(kind("mv_plan_counts"), "matview");
    assert_eq!(kind("events"), "table");
    assert_eq!(
        tables
            .iter()
            .find(|t| t.name == "paying_customers")
            .unwrap()
            .estimated_rows,
        None
    );
    // The seed script runs ANALYZE, so the planner's estimate is close to 250.
    let est = tables
        .iter()
        .find(|t| t.name == "events")
        .unwrap()
        .estimated_rows
        .unwrap();
    assert!((100..=500).contains(&est), "estimate was {est}");
    let billing = d.list_tables("billing").await.unwrap();
    assert!(billing.iter().any(|t| t.name == "invoices"));
}

#[tokio::test]
async fn an_unknown_schema_has_no_tables() {
    let d = driver_or_skip!();
    assert!(d.list_tables("no_such_schema").await.unwrap().is_empty());
}

#[tokio::test]
async fn structure_has_columns_indexes_and_foreign_keys() {
    let d = driver_or_skip!();
    let s = d.table_structure("public", "orders").await.unwrap();
    assert_eq!(s.kind, "table");
    assert_eq!(s.engine, None);
    let id = &s.columns[0];
    assert_eq!(id.name, "id");
    assert_eq!(id.key.as_deref(), Some("PRI"));
    assert!(!id.nullable);
    assert!(
        s.indexes.iter().any(|i| i.unique && i.columns == ["id"]),
        "{:?}",
        s.indexes
    );
    let partial = s
        .indexes
        .iter()
        .find(|i| i.name == "idx_orders_big")
        .unwrap();
    assert!(partial.index_type.contains("partial"), "{partial:?}");
    let expr = s
        .indexes
        .iter()
        .find(|i| i.name == "idx_orders_day")
        .unwrap();
    assert!(!expr.columns.is_empty());
    let def = partial.definition.as_deref().unwrap_or_default();
    assert!(
        def.starts_with("CREATE INDEX idx_orders_big ON") && def.contains("WHERE"),
        "{def}"
    );
    let fk = s.foreign_keys.first().unwrap();
    assert_eq!(fk.ref_table, "customers");
    assert_eq!(fk.ref_schema, "public");
    assert_eq!(fk.ref_columns, vec!["id"]);

    let c = d.table_structure("public", "customers").await.unwrap();
    let plan = c.columns.iter().find(|c| c.name == "plan").unwrap();
    assert_eq!(plan.data_type, "plan");
    let tags = c.columns.iter().find(|c| c.name == "tags").unwrap();
    assert_eq!(tags.data_type, "text[]");
}

#[tokio::test]
async fn a_view_says_it_is_a_view() {
    let d = driver_or_skip!();
    let s = d
        .table_structure("public", "paying_customers")
        .await
        .unwrap();
    assert_eq!(s.kind, "view");
    let m = d.table_structure("public", "mv_plan_counts").await.unwrap();
    assert_eq!(m.kind, "matview");
}

#[tokio::test]
async fn an_unknown_table_is_refused_plainly() {
    let d = driver_or_skip!();
    let err = d.table_structure("public", "nope").await.unwrap_err();
    assert!(matches!(err, AppError::InvalidArgument(_)), "{err:?}");
    let err = d
        .table_rows(
            "public",
            "nope\"; DROP TABLE events; --",
            0,
            10,
            &RowView::default(),
        )
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn rows_page_through_a_long_table() {
    let d = driver_or_skip!();
    let first = d
        .table_rows("public", "events", 0, 100, &RowView::default())
        .await
        .unwrap();
    assert_eq!(first.rows.len(), 100);
    assert!(first.has_more);
    assert_eq!(first.columns[0].name, "id");
    assert_eq!(first.rows[0][0].as_deref(), Some("1"));
    let last = d
        .table_rows("public", "events", 200, 100, &RowView::default())
        .await
        .unwrap();
    assert_eq!(last.rows.len(), 50);
    assert!(!last.has_more);
    assert_eq!(last.rows[0][0].as_deref(), Some("201"));
}

fn filtered(filter: &str) -> RowView {
    RowView {
        filter: Some(filter.to_string()),
        ..RowView::default()
    }
}

#[tokio::test]
async fn a_filter_narrows_the_rows_and_still_pages() {
    let d = driver_or_skip!();
    let few = d
        .table_rows("public", "events", 0, 100, &filtered("id > 240"))
        .await
        .unwrap();
    assert_eq!(few.rows.len(), 10);
    assert!(!few.has_more);
    let even = d
        .table_rows("public", "events", 0, 100, &filtered("id % 2 = 0"))
        .await
        .unwrap();
    assert_eq!(even.rows.len(), 100);
    assert!(even.has_more);
}

#[tokio::test]
async fn a_trailing_comment_in_the_filter_cannot_eat_the_rest() {
    let d = driver_or_skip!();
    let page = d
        .table_rows(
            "public",
            "events",
            0,
            100,
            &filtered("id > 248 -- the last two"),
        )
        .await
        .unwrap();
    assert_eq!(page.rows.len(), 2);
}

#[tokio::test]
async fn a_filter_with_no_matches_still_has_column_names() {
    let d = driver_or_skip!();
    let page = d
        .table_rows("public", "events", 0, 100, &filtered("id < 0"))
        .await
        .unwrap();
    assert!(page.rows.is_empty());
    assert_eq!(page.columns[0].name, "id");
    assert!(page.columns.len() >= 2);
    let empty = d
        .table_rows("public", "events", 10_000, 100, &RowView::default())
        .await
        .unwrap();
    assert!(empty.rows.is_empty());
    assert_eq!(empty.columns[0].name, "id");
}

#[tokio::test]
async fn sorting_orders_the_whole_table_and_rejects_unknown_columns() {
    let d = driver_or_skip!();
    let view = RowView {
        sort_column: Some("id".into()),
        sort_desc: true,
        ..RowView::default()
    };
    let page = d
        .table_rows("public", "events", 0, 100, &view)
        .await
        .unwrap();
    assert_eq!(page.rows[0][0].as_deref(), Some("250"));
    let bad = RowView {
        sort_column: Some("id\"; DROP TABLE events; --".into()),
        ..RowView::default()
    };
    let err = d
        .table_rows("public", "events", 0, 100, &bad)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Sql(_)), "got {err:?}");
}

#[tokio::test]
async fn a_filter_cannot_write_or_run_a_second_statement() {
    let d = driver_or_skip!();
    for filter in [
        "1=1; DROP TABLE events",
        "1=1) ; DELETE FROM events WHERE (1=1",
        "id = pg_sleep(0)::text::int",
        "1=1) UNION SELECT pg_terminate_backend(1)::int, 'x', 'y' FROM events WHERE (1=1",
    ] {
        let err = d
            .table_rows("public", "events", 0, 100, &filtered(filter))
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Blocked(_) | AppError::Sql(_)),
            "filter {filter:?} gave {err:?}"
        );
    }
    let all = d
        .table_rows("public", "events", 0, 100, &RowView::default())
        .await
        .unwrap();
    assert!(all.has_more);
}

#[tokio::test]
async fn awkward_names_are_quoted() {
    let d = driver_or_skip!();
    let page = d
        .table_rows("public", "Weird Name", 0, 100, &RowView::default())
        .await
        .unwrap();
    assert!(!page.columns.is_empty());
    let s = d.table_structure("public", "Weird Name").await.unwrap();
    assert!(!s.columns.is_empty());
}

#[tokio::test]
async fn a_table_without_a_primary_key_still_pages() {
    let d = driver_or_skip!();
    let page = d
        .table_rows("public", "loose_notes", 0, 100, &RowView::default())
        .await
        .unwrap();
    assert_eq!(page.rows.len(), 2);
}

#[tokio::test]
async fn null_and_empty_string_stay_different_and_types_are_named() {
    let d = driver_or_skip!();
    let r = run(
        &d,
        "SELECT 1 AS one, NULL AS nothing, '' AS blank, 'é' AS accent, \
         '{\"a\":1}'::jsonb AS doc, now() AS at, ARRAY['x','y'] AS arr, 'ab'::bytea AS raw",
    )
    .await
    .unwrap();
    let row = &r.rows[0];
    assert_eq!(row[0].as_deref(), Some("1"));
    assert_eq!(row[1], None);
    assert_eq!(row[2].as_deref(), Some(""));
    assert_eq!(row[3].as_deref(), Some("é"));
    assert_eq!(row[4].as_deref(), Some("{\"a\": 1}"));
    assert_eq!(row[6].as_deref(), Some("{x,y}"));
    assert_eq!(row[7].as_deref(), Some("0x6162"));
    let types: Vec<_> = r.columns.iter().map(|c| c.type_name.as_str()).collect();
    assert!(types.contains(&"JSONB"), "{types:?}");
    assert!(types.contains(&"TIMESTAMPTZ"), "{types:?}");
    assert!(types.contains(&"BYTEA"), "{types:?}");
}

// --- the query editor ---------------------------------------------------------

#[tokio::test]
async fn a_select_returns_columns_and_rows() {
    let d = driver_or_skip!();
    let r = run(&d, "SELECT id, kind FROM events ORDER BY id LIMIT 2")
        .await
        .unwrap();
    assert_eq!(r.columns.len(), 2);
    assert_eq!(cells(&r)[0][0], Some("1"));
    assert!(!r.truncated);
}

#[tokio::test]
async fn a_statement_with_no_rows_still_has_columns() {
    let d = driver_or_skip!();
    let r = run(&d, "SELECT id, kind FROM events WHERE false")
        .await
        .unwrap();
    assert!(r.rows.is_empty());
    let names: Vec<_> = r.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["id", "kind"]);
}

#[tokio::test]
async fn a_blocked_statement_is_refused_before_it_reaches_the_server() {
    let d = driver_or_skip!();
    let before = run(&d, "SELECT COUNT(*) FROM events").await.unwrap();
    for sql in [
        "DELETE FROM events",
        "UPDATE events SET kind = 'x'",
        "DROP TABLE events",
        "SELECT 1; DELETE FROM events",
        "COPY events TO '/tmp/fogtrail-test'",
        "SET default_transaction_read_only = off",
        "SELECT set_config('default_transaction_read_only', 'off', false)",
        "SELECT pg_terminate_backend(1)",
        "SELECT lo_import('/etc/passwd')",
    ] {
        match run(&d, sql).await {
            Err(AppError::Blocked(m)) => assert!(m.contains("Nothing was sent"), "{sql}: {m}"),
            other => panic!("{sql} should be blocked, got {other:?}"),
        }
    }
    let after = run(&d, "SELECT COUNT(*) FROM events").await.unwrap();
    assert_eq!(before.rows, after.rows);
}

#[tokio::test]
async fn the_read_only_transaction_stops_what_the_guard_lets_through() {
    // The guard lets these through; the server refuses them inside the read-only transaction.
    let Some(url) = std::env::var("FOGTRAIL_TEST_PG_RW_URL").ok() else {
        return;
    };
    let d = PostgresDriver::new(opts(&url));
    for sql in [
        "SELECT nextval('customers_id_seq')",
        "SELECT * FROM customers FOR UPDATE",
    ] {
        match run(&d, sql).await {
            Err(AppError::Sql(m)) => assert!(m.contains("read-only"), "{sql}: {m}"),
            Err(AppError::Blocked(_)) => {}
            other => panic!("{sql} should not run, got {other:?}"),
        }
    }
}

#[tokio::test]
async fn a_server_error_comes_back_in_the_servers_words() {
    let d = driver_or_skip!();
    match run(&d, "SELECT * FROM no_such_table").await {
        Err(AppError::Sql(m)) => assert!(m.contains("no_such_table"), "{m}"),
        other => panic!("expected a SQL error, got {other:?}"),
    }
    // The aborted transaction was rolled back, so the pool still works.
    assert!(run(&d, "SELECT 1").await.is_ok());
}

#[tokio::test]
async fn a_big_result_stops_at_the_limit_and_the_pool_stays_healthy() {
    let d = driver_or_skip!();
    let r = run(&d, "SELECT a.id, b.id FROM events a CROSS JOIN events b")
        .await
        .unwrap();
    assert_eq!(r.rows.len(), 1000);
    assert!(r.truncated);
    for _ in 0..6 {
        let r = run(&d, "SELECT a.id FROM events a CROSS JOIN events b")
            .await
            .unwrap();
        assert!(r.truncated);
    }
    assert!(!run(&d, "SELECT 1").await.unwrap().truncated);
}

#[tokio::test]
async fn exactly_the_limit_is_not_truncated() {
    let d = driver_or_skip!();
    let r = run(
        &d,
        "SELECT a.id FROM events a CROSS JOIN events b LIMIT 1000",
    )
    .await
    .unwrap();
    assert_eq!(r.rows.len(), 1000);
    assert!(!r.truncated);
}

#[tokio::test]
async fn a_slow_query_is_stopped_at_the_time_limit() {
    let Some(url) = url() else { return };
    let d = PostgresDriver::new(opts(&url)).with_query_seconds(2);
    let started = Instant::now();
    match run(
        &d,
        "SELECT SUM(a.id * b.id + c.id * e.id) FROM events a, events b, events c, events e",
    )
    .await
    {
        Err(AppError::Sql(m)) => assert!(m.contains("more than 2 seconds"), "{m}"),
        other => panic!("expected a timeout, got {other:?}"),
    }
    assert!(started.elapsed() < Duration::from_secs(8));
    assert!(run(&d, "SELECT 1").await.is_ok());
}

#[tokio::test]
async fn a_running_query_can_be_cancelled() {
    let Some(url) = url() else { return };
    let d = Arc::new(PostgresDriver::new(opts(&url)));
    let running = {
        let d = Arc::clone(&d);
        tokio::spawn(async move {
            d.run_query(
                "SELECT SUM(a.id * b.id + c.id * e.id) FROM events a, events b, events c, events e",
                None,
                "slow",
            )
            .await
        })
    };
    tokio::time::sleep(Duration::from_millis(800)).await;
    let started = Instant::now();
    d.cancel_query("slow").await.unwrap();
    match running.await.unwrap() {
        Err(AppError::Sql(m)) => assert_eq!(m, "Stopped."),
        other => panic!("unexpected outcome: {other:?}"),
    }
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(run(&d, "SELECT 1").await.is_ok());
}

#[tokio::test]
async fn cancelling_something_that_is_not_running_does_nothing() {
    let d = driver_or_skip!();
    d.cancel_query("never-ran").await.unwrap();
}

#[tokio::test]
async fn unqualified_names_use_the_schema_that_was_asked_for() {
    let d = driver_or_skip!();
    let r = d
        .run_query("SELECT COUNT(*) FROM invoices", Some("billing"), "t")
        .await
        .unwrap();
    assert_eq!(r.rows.len(), 1);
    let r = d
        .run_query("SELECT current_schema()", Some("billing"), "t")
        .await
        .unwrap();
    assert_eq!(cells(&r), vec![vec![Some("billing")]]);
    match d.run_query("SELECT 1", Some("no\"such"), "t").await {
        Ok(_) | Err(AppError::Sql(_)) => {}
        other => panic!("an odd schema name should not break anything, got {other:?}"),
    }
    // The search path was for that statement only.
    let r = d
        .run_query("SELECT current_schema()", None, "t")
        .await
        .unwrap();
    assert_eq!(cells(&r), vec![vec![Some("public")]]);
}

// --- read-only ---------------------------------------------------------------

#[tokio::test]
async fn the_session_defaults_to_read_only() {
    let Some(url) = url() else { return };
    let pool = postgres::pool_options()
        .connect_with(opts(&url))
        .await
        .unwrap();
    let v: String = sqlx::query_scalar("SHOW default_transaction_read_only")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(v, "on");
}

#[tokio::test]
async fn a_user_who_can_write_still_cannot_through_a_fogtrail_session() {
    let Ok(rw_url) = std::env::var("FOGTRAIL_TEST_PG_RW_URL") else {
        return;
    };
    let pool = postgres::pool_options()
        .connect_with(opts(&rw_url))
        .await
        .unwrap();
    let err = sqlx::raw_sql("INSERT INTO loose_notes VALUES ('nope')")
        .execute(&pool)
        .await
        .unwrap_err();
    assert!(err.to_string().contains("read-only"), "server said: {err}");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM loose_notes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn a_writer_cannot_switch_read_only_off_from_inside_the_editor() {
    let Ok(rw_url) = std::env::var("FOGTRAIL_TEST_PG_RW_URL") else {
        return;
    };
    let d = PostgresDriver::new(opts(&rw_url));
    // The guard refuses these first.
    for sql in [
        "SELECT set_config('default_transaction_read_only', 'off', false)",
        "SELECT set_config('transaction_read_only', 'off', true)",
        "SET TRANSACTION READ WRITE",
    ] {
        assert!(
            matches!(run(&d, sql).await, Err(AppError::Blocked(_))),
            "{sql}"
        );
    }
    // And even if the guard were out of the way, the server keeps the transaction
    // read-only. The driver has always run a query inside it before user SQL, so do the same.
    let pool = postgres::pool_options()
        .connect_with(opts(&rw_url))
        .await
        .unwrap();
    for attempt in [
        "SET TRANSACTION READ WRITE",
        "SELECT set_config('transaction_read_only', 'off', true)",
        "SELECT set_config('default_transaction_read_only', 'off', true)",
    ] {
        let mut conn = pool.acquire().await.unwrap();
        sqlx::raw_sql("BEGIN READ ONLY")
            .execute(&mut *conn)
            .await
            .unwrap();
        sqlx::raw_sql("SELECT pg_backend_pid()")
            .execute(&mut *conn)
            .await
            .unwrap();
        let _ = sqlx::raw_sql(attempt).execute(&mut *conn).await;
        let _ = sqlx::raw_sql("ROLLBACK").execute(&mut *conn).await;
        // A failed attempt aborts the transaction, so check in a fresh one that
        // the write is still refused where the attempt succeeded.
        sqlx::raw_sql("BEGIN READ ONLY")
            .execute(&mut *conn)
            .await
            .unwrap();
        sqlx::raw_sql("SELECT pg_backend_pid()")
            .execute(&mut *conn)
            .await
            .unwrap();
        if sqlx::raw_sql(attempt).execute(&mut *conn).await.is_ok() {
            let wrote = sqlx::raw_sql("INSERT INTO loose_notes VALUES ('nope')")
                .execute(&mut *conn)
                .await;
            assert!(wrote.is_err(), "{attempt} let a write through");
        }
        let _ = sqlx::raw_sql("ROLLBACK").execute(&mut *conn).await;
    }
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM loose_notes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
}

// --- connecting --------------------------------------------------------------

#[tokio::test]
async fn a_wrong_password_is_a_connect_error_that_does_not_echo_it() {
    let Some(url) = url() else { return };
    let (p, _) = profile_from(&url);
    let d = PostgresDriver::new(postgres::options(&p, Some("totally-wrong-pw")));
    let err = d.probe().await.unwrap_err();
    assert!(matches!(err, AppError::Connect(_)), "{err:?}");
    assert!(!err.to_string().contains("totally-wrong-pw"));
}

#[tokio::test]
async fn an_unreachable_server_gives_a_clean_connect_error() {
    let (p, _) = profile_from("postgres://u:p@127.0.0.1:1/x");
    let d = PostgresDriver::new(postgres::options(&p, Some("p")));
    let err = d.probe().await.unwrap_err();
    assert!(matches!(err, AppError::Connect(_)), "{err:?}");
    assert!(err.to_string().contains("127.0.0.1:1"));
}

#[tokio::test]
async fn a_saved_postgres_profile_connects_and_browses() {
    let Some(url) = url() else { return };
    let (profile, password) = profile_from(&url);
    let dir = std::env::temp_dir().join(format!("fogtrail-pg-it-{}", std::process::id()));
    let conns = Connections::new(
        ProfileStore::new(dir.join("c.json")),
        Box::new(MemoryStore::default()),
    );
    let tested = conns.test(&profile, Some(password.clone())).await.unwrap();
    assert_eq!(tested.product, "PostgreSQL");
    let saved = conns.save(profile, Some(password)).unwrap();
    let info = conns.connect(&saved.id).await.unwrap();
    assert_eq!(info.store, "sql");
    assert!(conns.sql().unwrap().list_schemas().await.unwrap().len() >= 2);
    assert!(matches!(
        conns.key_value().err().unwrap(),
        AppError::InvalidArgument(_)
    ));
    let _ = std::fs::remove_dir_all(dir);
}
