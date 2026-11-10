//! Runs against a real MySQL 8 server seeded with `scripts/seed-mysql.sql`.
//! Set `FOGTRAIL_TEST_MYSQL_URL` to the read-only user, for example
//! `mysql://fogtrail_ro:ro-test-pw@127.0.0.1:3306/shop`. Without it the tests skip.
//! One test also needs `FOGTRAIL_TEST_MYSQL_RW_URL` (the `fogtrail_rw` user) to
//! prove the server refuses writes from Fogtrail's read-only session.

use std::str::FromStr;

use fogtrail_lib::connections::Connections;
use fogtrail_lib::drivers::mysql::{self, MySqlDriver};
use fogtrail_lib::drivers::{Driver, SqlDriver};
use fogtrail_lib::error::AppError;
use fogtrail_lib::profiles::{Profile, ProfileStore};
use fogtrail_lib::secrets::MemoryStore;
use sqlx::mysql::MySqlConnectOptions;

fn url() -> Option<String> {
    std::env::var("FOGTRAIL_TEST_MYSQL_URL").ok()
}

fn driver() -> Option<MySqlDriver> {
    let opts = MySqlConnectOptions::from_str(&url()?).unwrap();
    Some(MySqlDriver::new(opts))
}

/// Splits `mysql://user:pass@host:port/schema` into a profile and its password.
fn profile_from(url: &str) -> (Profile, String) {
    let rest = url.strip_prefix("mysql://").unwrap();
    let (auth, addr) = rest.split_once('@').unwrap();
    let (user, pass) = auth.split_once(':').unwrap();
    let (hostport, schema) = addr.split_once('/').unwrap();
    let (host, port) = hostport.split_once(':').unwrap();
    (
        Profile {
            id: String::new(),
            name: "it".into(),
            driver: "mysql".into(),
            host: host.into(),
            port: port.parse().unwrap(),
            username: Some(user.into()),
            database: 0,
            schema: Some(schema.into()),
            tls: false,
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

#[tokio::test]
async fn probe_reports_product_and_version() {
    let d = driver_or_skip!();
    let p = d.probe().await.unwrap();
    assert!(p.product == "MySQL" || p.product == "MariaDB");
    assert!(p.version.chars().next().unwrap().is_ascii_digit());
    assert_eq!(p.key_count, None);
    assert_eq!(d.describe().store, "sql");
}

#[tokio::test]
async fn schemas_are_listed_and_system_ones_flagged() {
    let d = driver_or_skip!();
    let schemas = d.list_schemas().await.unwrap();
    let shop = schemas.iter().find(|s| s.name == "shop").unwrap();
    assert!(!shop.system);
    let info = schemas
        .iter()
        .find(|s| s.name == "information_schema")
        .unwrap();
    assert!(info.system);
}

#[tokio::test]
async fn tables_and_views_are_listed_with_estimates_for_tables_only() {
    let d = driver_or_skip!();
    let tables = d.list_tables("shop").await.unwrap();
    let names: Vec<&str> = tables.iter().map(|t| t.name.as_str()).collect();
    for want in [
        "customers",
        "events",
        "orders",
        "paying_customers",
        "weird name",
    ] {
        assert!(names.contains(&want), "missing {want} in {names:?}");
    }
    let view = tables
        .iter()
        .find(|t| t.name == "paying_customers")
        .unwrap();
    assert_eq!(view.kind, "view");
    assert_eq!(view.estimated_rows, None);
    let events = tables.iter().find(|t| t.name == "events").unwrap();
    assert_eq!(events.kind, "table");
    // An estimate, not a count: allow the usual InnoDB wobble around 250.
    let est = events.estimated_rows.unwrap();
    assert!((100..=500).contains(&est), "estimate was {est}");
}

#[tokio::test]
async fn an_unknown_schema_has_no_tables() {
    let d = driver_or_skip!();
    assert!(d.list_tables("no_such_schema").await.unwrap().is_empty());
}

#[tokio::test]
async fn structure_has_columns_indexes_and_foreign_keys() {
    let d = driver_or_skip!();
    let s = d.table_structure("shop", "orders").await.unwrap();
    assert_eq!(s.kind, "table");
    assert_eq!(s.engine.as_deref(), Some("InnoDB"));
    let id = &s.columns[0];
    assert_eq!(id.name, "id");
    assert_eq!(id.key.as_deref(), Some("PRI"));
    assert!(!id.nullable);
    assert_eq!(id.extra.as_deref(), Some("auto_increment"));
    assert_eq!(s.indexes[0].name, "PRIMARY");
    assert!(s.indexes[0].unique);
    assert!(
        s.indexes
            .iter()
            .any(|i| i.name == "idx_customer" && !i.unique)
    );
    let fk = s
        .foreign_keys
        .iter()
        .find(|f| f.name == "fk_orders_customer")
        .unwrap();
    assert_eq!(fk.columns, vec!["customer_id"]);
    assert_eq!(fk.ref_table, "customers");
    assert_eq!(fk.ref_columns, vec!["id"]);

    let c = d.table_structure("shop", "customers").await.unwrap();
    assert_eq!(c.comment.as_deref(), Some("People who buy things"));
    let plan = c.columns.iter().find(|c| c.name == "plan").unwrap();
    assert_eq!(plan.data_type, "enum('free','pro')");
    assert_eq!(plan.default.as_deref(), Some("free"));
    let email = c.columns.iter().find(|c| c.name == "email").unwrap();
    assert!(email.nullable);
}

#[tokio::test]
async fn a_view_says_it_is_a_view() {
    let d = driver_or_skip!();
    let s = d.table_structure("shop", "paying_customers").await.unwrap();
    assert_eq!(s.kind, "view");
    assert_eq!(s.comment, None);
    assert_eq!(s.columns.len(), 2);
}

#[tokio::test]
async fn rows_page_through_a_long_table() {
    let d = driver_or_skip!();
    let first = d.table_rows("shop", "events", 0, 100).await.unwrap();
    assert_eq!(first.rows.len(), 100);
    assert!(first.has_more);
    assert_eq!(first.columns[0].name, "id");
    assert_eq!(first.rows[0][0].as_deref(), Some("1"));
    assert_eq!(first.rows[0][1].as_deref(), Some("tick"));

    let last = d.table_rows("shop", "events", 200, 100).await.unwrap();
    assert_eq!(last.rows.len(), 50);
    assert!(!last.has_more);
    assert_eq!(last.rows[0][0].as_deref(), Some("201"));
}

#[tokio::test]
async fn an_empty_page_still_has_column_names() {
    let d = driver_or_skip!();
    let page = d.table_rows("shop", "events", 10_000, 100).await.unwrap();
    assert!(page.rows.is_empty());
    assert!(!page.has_more);
    let names: Vec<&str> = page.columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, vec!["id", "kind", "payload"]);
}

#[tokio::test]
async fn null_and_empty_string_stay_different() {
    let d = driver_or_skip!();
    let page = d.table_rows("shop", "customers", 0, 100).await.unwrap();
    let col = |name: &str| page.columns.iter().position(|c| c.name == name).unwrap();
    let (email, notes) = (col("email"), col("notes"));
    // Grace has no notes (NULL); Linus has no email (NULL) and empty notes.
    assert_eq!(page.rows[1][notes], None);
    assert_eq!(page.rows[2][email], None);
    assert_eq!(page.rows[2][notes].as_deref(), Some(""));
    assert_eq!(page.rows[0][notes].as_deref(), Some("héllo wörld — 日本語"));
    assert_eq!(page.rows[3][notes].as_deref(), Some("line one\nline two"));
}

#[tokio::test]
async fn other_column_types_arrive_readable() {
    let d = driver_or_skip!();
    let page = d.table_rows("shop", "products", 0, 100).await.unwrap();
    let col = |name: &str| page.columns.iter().position(|c| c.name == name).unwrap();
    let lamp = &page.rows[page
        .rows
        .iter()
        .position(|r| r[0].as_deref() == Some("LAMP-1"))
        .unwrap()];
    assert_eq!(lamp[col("price")].as_deref(), Some("25.00"));
    assert_eq!(lamp[col("photo")].as_deref(), Some("0x89504e470d0a1a0a"));
    assert!(lamp[col("attrs")].as_deref().unwrap().contains("brass"));
    assert_eq!(lamp[col("active")].as_deref(), Some("1"));
    assert_eq!(lamp[col("weight_kg")].as_deref(), Some("1.25"));
    assert_eq!(page.columns[col("photo")].type_name, "BLOB");
}

#[tokio::test]
async fn odd_table_names_and_tables_without_a_primary_key_work() {
    let d = driver_or_skip!();
    let weird = d.table_rows("shop", "weird name", 0, 10).await.unwrap();
    assert_eq!(weird.columns[0].name, "select");
    assert_eq!(weird.columns[1].name, "back`tick");
    assert_eq!(weird.rows[0][1].as_deref(), Some("2"));
    let loose = d.table_rows("shop", "loose_notes", 0, 10).await.unwrap();
    assert_eq!(loose.rows.len(), 2);
}

#[tokio::test]
async fn names_that_are_not_real_tables_never_reach_the_sql() {
    let d = driver_or_skip!();
    for evil in [
        "customers; DROP TABLE customers",
        "customers` WHERE 1=1 --",
        "nope",
    ] {
        let err = d.table_rows("shop", evil, 0, 10).await.unwrap_err();
        assert!(
            matches!(err, AppError::InvalidArgument(_)),
            "{evil}: {err:?}"
        );
        let err = d.table_structure("shop", evil).await.unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument(_)));
    }
    assert_eq!(
        d.table_rows("shop", "customers", 0, 100)
            .await
            .unwrap()
            .rows
            .len(),
        4
    );
}

#[tokio::test]
async fn a_user_who_can_write_still_cannot_through_a_fogtrail_session() {
    let Ok(rw_url) = std::env::var("FOGTRAIL_TEST_MYSQL_RW_URL") else {
        return;
    };
    // The same pool settings the app uses, with a user that has write privileges.
    let pool = mysql::pool_options()
        .connect_with(MySqlConnectOptions::from_str(&rw_url).unwrap())
        .await
        .unwrap();
    let err = sqlx::raw_sql("INSERT INTO loose_notes VALUES ('nope')")
        .execute(&pool)
        .await
        .unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("READ ONLY"), "server said: {msg}");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM loose_notes")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
}

#[tokio::test]
async fn a_wrong_password_is_a_connect_error_that_does_not_echo_it() {
    let Some(url) = url() else { return };
    let (mut p, _) = profile_from(&url);
    p.username = Some("fogtrail_ro".into());
    let d = MySqlDriver::new(mysql::options(&p, Some("totally-wrong-pw")));
    let err = d.probe().await.unwrap_err();
    assert!(matches!(err, AppError::Connect(_)), "{err:?}");
    assert!(!err.to_string().contains("totally-wrong-pw"));
}

#[tokio::test]
async fn an_unreachable_server_gives_a_clean_connect_error() {
    let (mut p, _) = profile_from("mysql://u:p@127.0.0.1:1/x");
    p.tls = false;
    let d = MySqlDriver::new(mysql::options(&p, Some("p")));
    let err = d.probe().await.unwrap_err();
    assert!(matches!(err, AppError::Connect(_)), "{err:?}");
    assert!(err.to_string().contains("127.0.0.1:1"));
}

#[tokio::test]
async fn a_saved_mysql_profile_connects_and_browses() {
    let Some(url) = url() else { return };
    let (profile, password) = profile_from(&url);
    let dir = std::env::temp_dir().join(format!("fogtrail-my-it-{}", std::process::id()));
    let conns = Connections::new(
        ProfileStore::new(dir.join("c.json")),
        Box::new(MemoryStore::default()),
    );
    let tested = conns.test(&profile, Some(password.clone())).await.unwrap();
    assert!(tested.product == "MySQL" || tested.product == "MariaDB");

    let saved = conns.save(profile, Some(password)).unwrap();
    let info = conns.connect(&saved.id).await.unwrap();
    assert_eq!(info.store, "sql");
    assert!(info.driver.starts_with("MySQL") || info.driver.starts_with("MariaDB"));
    assert!(conns.sql().unwrap().list_schemas().await.unwrap().len() >= 2);
    // A key-value command on a SQL connection is refused plainly.
    assert!(matches!(
        conns.key_value().err().unwrap(),
        AppError::InvalidArgument(_)
    ));
    let _ = std::fs::remove_dir_all(dir);
}
