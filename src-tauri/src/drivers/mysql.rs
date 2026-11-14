//! MySQL, read-only. Two things keep it from writing: every connection starts
//! in a read-only session (see [`pool_options`]), and this module only builds
//! SELECT statements itself. A read-only MySQL user adds a third layer on the
//! server side; the README says how to make one.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures_util::StreamExt;
use sqlx::mysql::{
    MySqlConnectOptions, MySqlDatabaseError, MySqlPoolOptions, MySqlRow, MySqlSslMode,
};
use sqlx::{Column, Executor, Row, TypeInfo};
use sqlx::{MySqlPool, ValueRef};
use tokio::sync::OnceCell;

use super::{
    ColumnInfo, ConnectionInfo, Driver, ForeignKeyInfo, IndexInfo, Probe, QueryResult,
    ResultColumn, RowPage, RowView, SchemaInfo, SqlDriver, TableInfo, TableStructure,
};
use crate::error::AppError;
use crate::profiles::Profile;
use crate::sql_guard;

/// Rows per page when the caller doesn't say, and the most it may ask for.
const PAGE_ROWS: u32 = 100;
const PAGE_ROWS_MAX: u32 = 500;
/// Most characters of a text cell that are sent to the UI.
const CELL_CHARS: usize = 2000;
/// Most bytes of a binary cell that are rendered as hex.
const CELL_HEX_BYTES: usize = 1024;
/// The most rows the query editor returns.
pub const QUERY_ROWS: u32 = 1000;
/// The longest a statement may run, in seconds. The server enforces it for
/// SELECT; the driver enforces it for everything else (a little later, so the
/// server's own message wins when it can give one).
pub const QUERY_SECONDS: u64 = 30;
const SYSTEM_SCHEMAS: [&str; 4] = ["information_schema", "mysql", "performance_schema", "sys"];

/// Pool settings, public so tests can check the read-only session on the real thing.
pub fn pool_options() -> MySqlPoolOptions {
    pool_options_with(QUERY_SECONDS)
}

fn pool_options_with(query_seconds: u64) -> MySqlPoolOptions {
    MySqlPoolOptions::new()
        .max_connections(4)
        // Fail fast: a wrong host should show an error in seconds.
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(move |conn, _meta| {
            Box::pin(async move {
                sqlx::query("SET SESSION TRANSACTION READ ONLY")
                    .execute(&mut *conn)
                    .await?;
                // Stops a SELECT that runs too long. A server without this variable
                // (MariaDB calls it max_statement_time) just doesn't get the limit; the
                // driver's own deadline still applies.
                let _ = sqlx::query(&format!(
                    "SET SESSION max_execution_time = {}",
                    query_seconds * 1000
                ))
                .execute(&mut *conn)
                .await;
                Ok(())
            })
        })
}

/// Connection options for a saved profile. The password is passed separately
/// because it lives in the keychain, not in the profile.
pub fn options(profile: &Profile, password: Option<&str>) -> MySqlConnectOptions {
    let mut o = MySqlConnectOptions::new()
        .host(profile.host.trim())
        .port(profile.port)
        // Off means off. On means the certificate and host name are checked.
        .ssl_mode(if profile.tls {
            MySqlSslMode::VerifyIdentity
        } else {
            MySqlSslMode::Disabled
        });
    if let Some(u) = profile.username.as_deref().filter(|u| !u.is_empty()) {
        o = o.username(u);
    }
    if let Some(p) = password.filter(|p| !p.is_empty()) {
        o = o.password(p);
    }
    if let Some(s) = profile
        .schema
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        o = o.database(s);
    }
    o
}

pub struct MySqlDriver {
    options: MySqlConnectOptions,
    address: String,
    pool: OnceCell<MySqlPool>,
    /// Statements in flight: the editor's run id and the server's connection id,
    /// so a cancel can send `KILL QUERY` to the right one.
    running: Arc<Mutex<HashMap<String, u64>>>,
    query_seconds: u64,
}

impl MySqlDriver {
    pub fn new(options: MySqlConnectOptions) -> Self {
        let address = format!("{}:{}", options.get_host(), options.get_port());
        Self {
            options,
            address,
            pool: OnceCell::new(),
            running: Arc::new(Mutex::new(HashMap::new())),
            query_seconds: QUERY_SECONDS,
        }
    }

    /// A shorter time limit, so tests don't have to wait 30 seconds.
    pub fn with_query_seconds(mut self, seconds: u64) -> Self {
        self.query_seconds = seconds;
        self
    }

    /// Connects on first use. A failed attempt leaves nothing behind, so the next call retries.
    async fn pool(&self) -> Result<&MySqlPool, AppError> {
        self.pool
            .get_or_try_init(|| async {
                pool_options_with(self.query_seconds)
                    .connect_with(self.options.clone())
                    .await
                    .map_err(|e| to_app_error(e, &self.address))
            })
            .await
    }

    fn err(&self, e: sqlx::Error) -> AppError {
        to_app_error(e, &self.address)
    }

    /// Fails with a plain message when the table doesn't exist or isn't visible.
    /// Returns `"table"` or `"view"`.
    async fn kind_of(&self, schema: &str, table: &str) -> Result<String, AppError> {
        let pool = self.pool().await?;
        let row = sqlx::query(
            "SELECT CAST(TABLE_TYPE AS CHAR) FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        )
        .bind(schema)
        .bind(table)
        .fetch_optional(pool)
        .await
        .map_err(|e| self.err(e))?;
        match row.and_then(|r| text(&r, 0)) {
            Some(t) => Ok(kind_name(&t).to_string()),
            None => Err(AppError::InvalidArgument(format!(
                "There is no table {} in {}.",
                quote_ident(table),
                quote_ident(schema)
            ))),
        }
    }
}

#[async_trait]
impl Driver for MySqlDriver {
    fn describe(&self) -> ConnectionInfo {
        ConnectionInfo {
            driver: "MySQL".to_string(),
            address: self.address.clone(),
            database: 0,
            store: "sql".to_string(),
        }
    }

    async fn probe(&self) -> Result<Probe, AppError> {
        let pool = self.pool().await?;
        let row = sqlx::query("SELECT CAST(VERSION() AS CHAR)")
            .fetch_one(pool)
            .await
            .map_err(|e| self.err(e))?;
        let (product, version) = detect(&text(&row, 0).unwrap_or_default());
        Ok(Probe {
            product,
            version,
            key_count: None,
        })
    }
}

#[async_trait]
impl SqlDriver for MySqlDriver {
    async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let pool = self.pool().await?;
        let rows = sqlx::query(
            "SELECT CAST(SCHEMA_NAME AS CHAR) FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        Ok(rows
            .iter()
            .filter_map(|r| text(r, 0))
            .map(|name| SchemaInfo {
                system: SYSTEM_SCHEMAS.contains(&name.to_lowercase().as_str()),
                name,
            })
            .collect())
    }

    async fn list_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let pool = self.pool().await?;
        let rows = sqlx::query(
            "SELECT CAST(TABLE_NAME AS CHAR), CAST(TABLE_TYPE AS CHAR), CAST(TABLE_ROWS AS CHAR) \
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
        )
        .bind(schema)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        Ok(rows
            .iter()
            .filter_map(|r| {
                let name = text(r, 0)?;
                let kind = kind_name(&text(r, 1)?).to_string();
                let estimated_rows = if kind == "view" {
                    None
                } else {
                    text(r, 2).and_then(|n| n.parse().ok())
                };
                Some(TableInfo {
                    name,
                    kind,
                    estimated_rows,
                })
            })
            .collect())
    }

    async fn table_structure(&self, schema: &str, table: &str) -> Result<TableStructure, AppError> {
        let kind = self.kind_of(schema, table).await?;
        let pool = self.pool().await?;
        let meta = sqlx::query(
            "SELECT CAST(ENGINE AS CHAR), CAST(TABLE_COMMENT AS CHAR) \
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        )
        .bind(schema)
        .bind(table)
        .fetch_one(pool)
        .await
        .map_err(|e| self.err(e))?;
        let columns = sqlx::query(
            "SELECT CAST(COLUMN_NAME AS CHAR), CAST(COLUMN_TYPE AS CHAR), CAST(IS_NULLABLE AS CHAR), \
                    CAST(COLUMN_KEY AS CHAR), CAST(COLUMN_DEFAULT AS CHAR), CAST(EXTRA AS CHAR), \
                    CAST(COLUMN_COMMENT AS CHAR) \
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
             ORDER BY ORDINAL_POSITION",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        let index_rows = sqlx::query(
            "SELECT CAST(INDEX_NAME AS CHAR), CAST(NON_UNIQUE AS CHAR), CAST(COLUMN_NAME AS CHAR), \
                    CAST(INDEX_TYPE AS CHAR) \
             FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
             ORDER BY INDEX_NAME, SEQ_IN_INDEX",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        let fk_rows = sqlx::query(
            "SELECT CAST(CONSTRAINT_NAME AS CHAR), CAST(COLUMN_NAME AS CHAR), \
                    CAST(REFERENCED_TABLE_SCHEMA AS CHAR), CAST(REFERENCED_TABLE_NAME AS CHAR), \
                    CAST(REFERENCED_COLUMN_NAME AS CHAR) \
             FROM information_schema.KEY_COLUMN_USAGE \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL \
             ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;

        Ok(TableStructure {
            kind: kind.clone(),
            engine: text(&meta, 0),
            // MySQL stores the word "VIEW" in a view's comment.
            comment: text(&meta, 1).filter(|c| !c.is_empty() && !(kind == "view" && c == "VIEW")),
            columns: columns
                .iter()
                .map(|r| ColumnInfo {
                    name: text(r, 0).unwrap_or_default(),
                    data_type: text(r, 1).unwrap_or_default(),
                    nullable: text(r, 2).as_deref() == Some("YES"),
                    key: text(r, 3).filter(|k| !k.is_empty()),
                    default: text(r, 4),
                    extra: text(r, 5).filter(|e| !e.is_empty()),
                    comment: text(r, 6).filter(|c| !c.is_empty()),
                })
                .collect(),
            indexes: group_indexes(
                index_rows
                    .iter()
                    .map(|r| {
                        (
                            text(r, 0).unwrap_or_default(),
                            text(r, 1).as_deref() == Some("0"),
                            text(r, 2).unwrap_or_else(|| "(expression)".to_string()),
                            text(r, 3).unwrap_or_default(),
                        )
                    })
                    .collect(),
            ),
            foreign_keys: group_foreign_keys(
                fk_rows
                    .iter()
                    .map(|r| {
                        (
                            text(r, 0).unwrap_or_default(),
                            text(r, 1).unwrap_or_default(),
                            text(r, 2).unwrap_or_default(),
                            text(r, 3).unwrap_or_default(),
                            text(r, 4).unwrap_or_default(),
                        )
                    })
                    .collect(),
            ),
        })
    }

    async fn table_rows(
        &self,
        schema: &str,
        table: &str,
        offset: u64,
        count: u32,
        view: &RowView,
    ) -> Result<RowPage, AppError> {
        // Checked against the server's own list, so only real names are ever quoted into SQL.
        self.kind_of(schema, table).await?;
        let pool = self.pool().await?;
        let count = if count == 0 { PAGE_ROWS } else { count }.min(PAGE_ROWS_MAX);
        // A stable order makes pages line up; without a primary key the server decides.
        let pk = sqlx::query(
            "SELECT CAST(COLUMN_NAME AS CHAR) FROM information_schema.STATISTICS \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY' \
             ORDER BY SEQ_IN_INDEX",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        let pk: Vec<String> = pk.iter().filter_map(|r| text(r, 0)).collect();
        if view.filter.as_deref().is_some_and(|f| !f.trim().is_empty())
            || view.sort_column.is_some()
        {
            return self
                .view_rows(schema, table, &pk, offset, count, view)
                .await;
        }
        let sql = page_sql(schema, table, &pk, offset, count);
        // `raw_sql` uses the text protocol, so every value arrives as text.
        let rows = sqlx::raw_sql(&sql)
            .fetch_all(pool)
            .await
            .map_err(|e| self.err(e))?;
        let columns: Vec<ResultColumn> = rows
            .first()
            .map(|r| {
                r.columns()
                    .iter()
                    .map(|c| ResultColumn {
                        name: c.name().to_string(),
                        type_name: c.type_info().name().to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let has_more = rows.len() > count as usize;
        let rows = rows
            .iter()
            .take(count as usize)
            .map(|r| {
                (0..r.len())
                    .map(|i| cell(r, i, r.columns()[i].type_info().name()))
                    .collect()
            })
            .collect();
        // An empty page has no row to read the column names from, so ask for them.
        let columns = if columns.is_empty() {
            self.column_names(schema, table).await?
        } else {
            columns
        };
        Ok(RowPage {
            columns,
            rows,
            offset,
            has_more,
        })
    }

    async fn run_query(
        &self,
        sql: &str,
        schema: Option<&str>,
        run_id: &str,
    ) -> Result<QueryResult, AppError> {
        // Nothing reaches the server until the guard has said yes.
        sql_guard::check(sql, sql_guard::Dialect::MySql)?;
        let pool = self.pool().await?;
        let mut conn = pool.acquire().await.map_err(|e| self.err(e))?;
        // Unqualified table names mean the schema open in the UI. A pooled connection
        // may have been left on another one, so say it every time. The name is quoted,
        // and the server refuses one that doesn't exist.
        if let Some(schema) = schema.map(str::trim).filter(|s| !s.is_empty()) {
            let use_schema = format!("USE {}", quote_ident(schema));
            conn.execute(use_schema.as_str())
                .await
                .map_err(|e| self.err(e))?;
        }
        let connection_id: u64 = sqlx::query("SELECT CONNECTION_ID()")
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| self.err(e))
            .map(|r| r.try_get_unchecked::<u64, _>(0).unwrap_or(0))?;
        let _registered = Registered::new(&self.running, run_id, connection_id);

        let started = Instant::now();
        let read = read_rows(&mut conn, sql);
        let outcome =
            match tokio::time::timeout(Duration::from_secs(self.query_seconds + 2), read).await {
                Ok(done) => done,
                Err(_) => {
                    // The deadline passed without a reply: stop the statement on the server.
                    self.kill(connection_id).await;
                    return Err(timed_out(self.query_seconds));
                }
            };
        let (columns, rows, truncated) = match outcome {
            Ok(v) => v,
            Err(e) => return Err(self.query_error(e)),
        };
        if truncated {
            // Stopped reading with rows still on the wire, so this connection can't be
            // reused. Detach it and let the pool open a fresh one.
            drop(conn.detach());
        }
        Ok(QueryResult {
            columns,
            rows,
            truncated,
            row_limit: QUERY_ROWS,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }

    async fn cancel_query(&self, run_id: &str) -> Result<(), AppError> {
        let id = self
            .running
            .lock()
            .ok()
            .and_then(|m| m.get(run_id).copied());
        if let Some(id) = id {
            self.kill(id).await;
        }
        Ok(())
    }
}

impl MySqlDriver {
    /// `KILL QUERY` on another connection. Best effort: if it fails, the deadline still ends the wait.
    async fn kill(&self, connection_id: u64) {
        if connection_id == 0 {
            return;
        }
        if let Ok(pool) = self.pool().await {
            let _ = sqlx::query(&format!("KILL QUERY {connection_id}"))
                .execute(pool)
                .await;
        }
    }

    /// The server's own words, except for the two ways a statement is stopped on purpose.
    fn query_error(&self, e: sqlx::Error) -> AppError {
        if let sqlx::Error::Database(db) = &e {
            match db
                .try_downcast_ref::<MySqlDatabaseError>()
                .map(MySqlDatabaseError::number)
            {
                // 3024: max_execution_time was exceeded.
                Some(3024) => return timed_out(self.query_seconds),
                // 1317: the statement was interrupted by KILL QUERY.
                Some(1317) => return AppError::Sql("Stopped.".to_string()),
                _ => {}
            }
        }
        self.err(e)
    }

    /// A page of rows with a filter or a sort. It goes through `run_query`, so the
    /// whole statement is checked by `sql_guard` and the row cap, the time limit and
    /// the read-only session all apply, whatever the filter text says.
    async fn view_rows(
        &self,
        schema: &str,
        table: &str,
        pk: &[String],
        offset: u64,
        count: u32,
        view: &RowView,
    ) -> Result<RowPage, AppError> {
        // A sort column must be a real column, so only real names are ever quoted.
        let sort = match view.sort_column.as_deref() {
            None => None,
            Some(name) => {
                let known = self.column_names(schema, table).await?;
                if !known.iter().any(|c| c.name == name) {
                    return Err(AppError::Sql(format!("Unknown column '{name}'")));
                }
                Some((name, view.sort_desc))
            }
        };
        let filter = view
            .filter
            .as_deref()
            .map(str::trim)
            .filter(|f| !f.is_empty());
        let sql = view_sql(schema, table, pk, offset, count, filter, sort);
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let run_id = format!("rows-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let result = self.run_query(&sql, None, &run_id).await?;
        let has_more = result.rows.len() > count as usize;
        let mut rows = result.rows;
        rows.truncate(count as usize);
        Ok(RowPage {
            columns: result.columns,
            rows,
            offset,
            has_more,
        })
    }

    async fn column_names(&self, schema: &str, table: &str) -> Result<Vec<ResultColumn>, AppError> {
        let pool = self.pool().await?;
        let rows = sqlx::query(
            "SELECT CAST(COLUMN_NAME AS CHAR), CAST(DATA_TYPE AS CHAR) \
             FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
             ORDER BY ORDINAL_POSITION",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        Ok(rows
            .iter()
            .map(|r| ResultColumn {
                name: text(r, 0).unwrap_or_default(),
                type_name: text(r, 1).unwrap_or_default().to_uppercase(),
            })
            .collect())
    }
}

/// Registers a running statement for as long as it runs.
struct Registered {
    running: Arc<Mutex<HashMap<String, u64>>>,
    run_id: String,
}

impl Registered {
    fn new(running: &Arc<Mutex<HashMap<String, u64>>>, run_id: &str, connection_id: u64) -> Self {
        if let Ok(mut m) = running.lock() {
            m.insert(run_id.to_string(), connection_id);
        }
        Self {
            running: Arc::clone(running),
            run_id: run_id.to_string(),
        }
    }
}

impl Drop for Registered {
    fn drop(&mut self) {
        if let Ok(mut m) = self.running.lock() {
            m.remove(&self.run_id);
        }
    }
}

fn timed_out(seconds: u64) -> AppError {
    AppError::Sql(format!(
        "The query ran for more than {seconds} seconds and was stopped."
    ))
}

type Rows = (Vec<ResultColumn>, Vec<Vec<Option<String>>>, bool);

/// Reads up to [`QUERY_ROWS`] rows, one at a time. `raw_sql` uses the text
/// protocol, so every value arrives as text, the same as in the table view.
async fn read_rows(conn: &mut sqlx::MySqlConnection, sql: &str) -> Result<Rows, sqlx::Error> {
    let mut columns: Vec<ResultColumn> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut truncated = false;
    {
        let mut stream = sqlx::raw_sql(sql).fetch(&mut *conn);
        while let Some(row) = stream.next().await {
            let row = row?;
            if columns.is_empty() {
                columns = result_columns(&row);
            }
            if rows.len() >= QUERY_ROWS as usize {
                truncated = true;
                break;
            }
            rows.push(
                (0..row.len())
                    .map(|i| cell(&row, i, row.columns()[i].type_info().name()))
                    .collect(),
            );
        }
    }
    // No rows means no row to read the column names from. Ask the server to describe it.
    if columns.is_empty()
        && let Ok(d) = conn.describe(sql).await
    {
        columns = d
            .columns()
            .iter()
            .map(|c| ResultColumn {
                name: c.name().to_string(),
                type_name: c.type_info().name().to_string(),
            })
            .collect();
    }
    Ok((columns, rows, truncated))
}

fn result_columns(row: &MySqlRow) -> Vec<ResultColumn> {
    row.columns()
        .iter()
        .map(|c| ResultColumn {
            name: c.name().to_string(),
            type_name: c.type_info().name().to_string(),
        })
        .collect()
}

/// Quotes a schema, table or column name for use in SQL.
pub fn quote_ident(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

fn page_sql(schema: &str, table: &str, pk: &[String], offset: u64, count: u32) -> String {
    let order = if pk.is_empty() {
        String::new()
    } else {
        let cols: Vec<String> = pk.iter().map(|c| quote_ident(c)).collect();
        format!(" ORDER BY {}", cols.join(", "))
    };
    // One extra row tells us whether there is another page.
    format!(
        "SELECT * FROM {}.{}{order} LIMIT {} OFFSET {offset}",
        quote_ident(schema),
        quote_ident(table),
        count + 1
    )
}

/// The statement for a filtered or sorted page. The filter sits on its own lines
/// inside the parentheses, so a `--` or `#` comment at its end can't swallow the
/// closing one. `sql_guard` checks the finished statement before it is sent.
fn view_sql(
    schema: &str,
    table: &str,
    pk: &[String],
    offset: u64,
    count: u32,
    filter: Option<&str>,
    sort: Option<(&str, bool)>,
) -> String {
    let wher = filter.map_or(String::new(), |f| format!(" WHERE (\n{f}\n)"));
    let mut order: Vec<String> = Vec::new();
    if let Some((column, desc)) = sort {
        order.push(format!(
            "{}{}",
            quote_ident(column),
            if desc { " DESC" } else { "" }
        ));
    }
    // The primary key breaks ties, so pages line up.
    order.extend(
        pk.iter()
            .filter(|c| sort.is_none_or(|(s, _)| s != c.as_str()))
            .map(|c| quote_ident(c)),
    );
    let order = if order.is_empty() {
        String::new()
    } else {
        format!(" ORDER BY {}", order.join(", "))
    };
    format!(
        "SELECT * FROM {}.{}{wher}{order} LIMIT {} OFFSET {offset}",
        quote_ident(schema),
        quote_ident(table),
        count + 1
    )
}

fn kind_name(table_type: &str) -> &'static str {
    if table_type.contains("VIEW") {
        "view"
    } else {
        "table"
    }
}

/// Product and version from `SELECT VERSION()`, such as `8.0.36` or `10.11.6-MariaDB`.
fn detect(raw: &str) -> (String, String) {
    let product = if raw.to_lowercase().contains("mariadb") {
        "MariaDB"
    } else {
        "MySQL"
    };
    let version = raw.split('-').next().unwrap_or(raw).trim();
    (product.to_string(), version.to_string())
}

/// A text column, or `None` for NULL. Reads the raw bytes, because MySQL 8's
/// information_schema columns report types sqlx won't decode as `String`.
fn text(row: &MySqlRow, i: usize) -> Option<String> {
    let bytes = row.try_get_unchecked::<Option<Vec<u8>>, _>(i).ok()??;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// One result cell as the UI shows it.
fn cell(row: &MySqlRow, i: usize, type_name: &str) -> Option<String> {
    let raw = row.try_get_raw(i).ok()?;
    if raw.is_null() {
        return None;
    }
    let bytes = row.try_get_unchecked::<Vec<u8>, _>(i).ok()?;
    Some(cell_text(type_name, &bytes))
}

/// Binary types are shown as hex, everything else as text, both cut to a sane size.
fn cell_text(type_name: &str, bytes: &[u8]) -> String {
    let binary = matches!(
        type_name,
        "BINARY"
            | "VARBINARY"
            | "BLOB"
            | "TINYBLOB"
            | "MEDIUMBLOB"
            | "LONGBLOB"
            | "BIT"
            | "GEOMETRY"
    );
    if binary {
        let shown = &bytes[..bytes.len().min(CELL_HEX_BYTES)];
        let hex: String = shown.iter().map(|b| format!("{b:02x}")).collect();
        let more = if bytes.len() > shown.len() { "…" } else { "" };
        return format!("0x{hex}{more}");
    }
    let s = String::from_utf8_lossy(bytes);
    if s.chars().count() > CELL_CHARS {
        let cut: String = s.chars().take(CELL_CHARS).collect();
        format!("{cut}…")
    } else {
        s.into_owned()
    }
}

/// Groups one-row-per-column index rows into indexes. Rows arrive ordered by
/// index name then position; `PRIMARY` is moved to the front.
fn group_indexes(rows: Vec<(String, bool, String, String)>) -> Vec<IndexInfo> {
    let mut out: Vec<IndexInfo> = Vec::new();
    for (name, unique, column, index_type) in rows {
        match out.last_mut() {
            Some(last) if last.name == name => last.columns.push(column),
            _ => out.push(IndexInfo {
                name,
                unique,
                columns: vec![column],
                index_type,
            }),
        }
    }
    out.sort_by_key(|i| i.name != "PRIMARY");
    out
}

fn group_foreign_keys(rows: Vec<(String, String, String, String, String)>) -> Vec<ForeignKeyInfo> {
    let mut out: Vec<ForeignKeyInfo> = Vec::new();
    for (name, column, ref_schema, ref_table, ref_column) in rows {
        match out.last_mut() {
            Some(last) if last.name == name => {
                last.columns.push(column);
                last.ref_columns.push(ref_column);
            }
            _ => out.push(ForeignKeyInfo {
                name,
                columns: vec![column],
                ref_schema,
                ref_table,
                ref_columns: vec![ref_column],
            }),
        }
    }
    out
}

/// Turns what sqlx reports into something the UI can show. The server's own
/// message is kept for statement errors; connection problems name the address.
fn to_app_error(e: sqlx::Error, address: &str) -> AppError {
    match &e {
        sqlx::Error::Database(db) => {
            // `code()` is the SQLSTATE; MySQL's own error number is on the MySQL error type.
            let number = db
                .try_downcast_ref::<MySqlDatabaseError>()
                .map(MySqlDatabaseError::number);
            match number {
                // 1045 access denied, 1044 no access to the schema, 1049 unknown schema.
                Some(1044 | 1045 | 1049) => AppError::Connect(db.message().to_string()),
                _ => AppError::Sql(db.message().to_string()),
            }
        }
        sqlx::Error::Io(_)
        | sqlx::Error::Tls(_)
        | sqlx::Error::PoolTimedOut
        | sqlx::Error::Configuration(_)
        | sqlx::Error::Protocol(_) => {
            AppError::Connect(format!("Could not connect to {address}: {e}"))
        }
        _ => AppError::Sql(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_quoted_and_backticks_doubled() {
        assert_eq!(quote_ident("orders"), "`orders`");
        assert_eq!(quote_ident("back`tick"), "`back``tick`");
        assert_eq!(
            quote_ident("x`; DROP TABLE y; --"),
            "`x``; DROP TABLE y; --`"
        );
    }

    #[test]
    fn a_page_asks_for_one_extra_row_and_orders_by_the_primary_key() {
        let sql = page_sql("shop", "orders", &["id".into()], 200, 100);
        assert_eq!(
            sql,
            "SELECT * FROM `shop`.`orders` ORDER BY `id` LIMIT 101 OFFSET 200"
        );
        let sql = page_sql("s", "t", &["a".into(), "b".into()], 0, 10);
        assert!(sql.contains("ORDER BY `a`, `b` LIMIT 11 OFFSET 0"));
        assert!(!page_sql("s", "t", &[], 0, 10).contains("ORDER BY"));
    }

    #[test]
    fn a_filtered_page_keeps_the_filter_inside_its_own_parentheses() {
        let sql = view_sql(
            "shop",
            "orders",
            &["id".into()],
            0,
            100,
            Some("status = 'paid' -- only paid"),
            Some(("total", true)),
        );
        assert_eq!(
            sql,
            "SELECT * FROM `shop`.`orders` WHERE (\nstatus = 'paid' -- only paid\n) \
             ORDER BY `total` DESC, `id` LIMIT 101 OFFSET 0"
        );
        // Sorting by the primary key does not list it twice.
        let sql = view_sql("s", "t", &["id".into()], 5, 10, None, Some(("id", false)));
        assert_eq!(sql, "SELECT * FROM `s`.`t` ORDER BY `id` LIMIT 11 OFFSET 5");
    }

    #[test]
    fn product_and_version_are_split_out() {
        assert_eq!(detect("8.0.36"), ("MySQL".into(), "8.0.36".into()));
        assert_eq!(
            detect("8.0.46-0ubuntu0.24.04.4"),
            ("MySQL".into(), "8.0.46".into())
        );
        assert_eq!(
            detect("10.11.6-MariaDB-1:10.11.6"),
            ("MariaDB".into(), "10.11.6".into())
        );
    }

    #[test]
    fn binary_cells_become_hex_and_text_stays_text() {
        assert_eq!(cell_text("BLOB", &[0x89, 0x50]), "0x8950");
        assert_eq!(cell_text("VARCHAR", "héllo".as_bytes()), "héllo");
        let long = vec![0xAB; CELL_HEX_BYTES + 1];
        assert!(cell_text("BLOB", &long).ends_with('…'));
        let text = "x".repeat(CELL_CHARS + 5);
        let shown = cell_text("TEXT", text.as_bytes());
        assert_eq!(shown.chars().count(), CELL_CHARS + 1);
        assert!(shown.ends_with('…'));
    }

    #[test]
    fn index_rows_are_grouped_with_the_primary_key_first() {
        let rows = vec![
            ("idx_a".into(), true, "a".into(), "BTREE".into()),
            ("idx_a".into(), true, "b".into(), "BTREE".into()),
            ("PRIMARY".into(), false, "id".into(), "BTREE".into()),
        ];
        let out = group_indexes(rows);
        assert_eq!(out[0].name, "PRIMARY");
        assert!(!out[0].unique);
        assert_eq!(out[1].columns, vec!["a", "b"]);
    }

    #[test]
    fn foreign_key_rows_are_grouped_per_constraint() {
        let rows = vec![
            ("fk".into(), "a".into(), "s".into(), "t".into(), "x".into()),
            ("fk".into(), "b".into(), "s".into(), "t".into(), "y".into()),
        ];
        let out = group_foreign_keys(rows);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].columns, vec!["a", "b"]);
        assert_eq!(out[0].ref_columns, vec!["x", "y"]);
    }

    #[test]
    fn connection_failures_name_the_address() {
        let e = to_app_error(sqlx::Error::PoolTimedOut, "db:3306");
        assert!(matches!(&e, AppError::Connect(m) if m.contains("db:3306")));
        let e = to_app_error(sqlx::Error::RowNotFound, "db:3306");
        assert!(matches!(e, AppError::Sql(_)));
    }

    #[test]
    fn options_use_tls_checks_only_when_asked() {
        let mut p = Profile {
            id: String::new(),
            name: "x".into(),
            driver: "mysql".into(),
            host: " db.internal ".into(),
            port: 3307,
            username: Some("ro".into()),
            database: 0,
            schema: Some("shop".into()),
            tls: false,
            dbname: None,
            ssl_mode: None,
        };
        let o = options(&p, Some("pw"));
        assert_eq!(o.get_host(), "db.internal");
        assert_eq!(o.get_port(), 3307);
        assert_eq!(o.get_database(), Some("shop"));
        assert!(matches!(o.get_ssl_mode(), MySqlSslMode::Disabled));
        p.tls = true;
        assert!(matches!(
            options(&p, None).get_ssl_mode(),
            MySqlSslMode::VerifyIdentity
        ));
    }
}
