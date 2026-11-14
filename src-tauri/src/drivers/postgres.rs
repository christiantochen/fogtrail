//! PostgreSQL, read-only. Three things keep it from writing: every connection
//! defaults to read-only transactions (see [`pool_options`]), every statement the
//! app sends runs inside its own `BEGIN READ ONLY` (see [`PostgresDriver::run`]), and
//! this module only builds SELECT statements itself. A read-only role adds a layer on
//! the server side; the README says how to make one. Statements typed by the person
//! also pass `sql_guard` first.
//!
//! One connection opens one database, as PostgreSQL itself does. What the sidebar
//! calls a schema is a PostgreSQL schema (`public`, `billing`, ...).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures_util::StreamExt;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgRow, PgSslMode};
use sqlx::{Column, Executor, PgPool, Row, TypeInfo, ValueRef};
use tokio::sync::OnceCell;

use super::{
    ColumnInfo, ConnectionInfo, Driver, ForeignKeyInfo, IndexInfo, Probe, QueryResult,
    ResultColumn, RowPage, RowView, SchemaInfo, SqlDriver, TableInfo, TableStructure,
};
use crate::error::AppError;
use crate::profiles::Profile;
use crate::sql_guard::{self, Dialect};

/// Rows per page when the caller doesn't say, and the most it may ask for.
const PAGE_ROWS: u32 = 100;
const PAGE_ROWS_MAX: u32 = 500;
/// Most characters of a text cell that are sent to the UI.
const CELL_CHARS: usize = 2000;
/// Most bytes of a binary cell that are rendered as hex.
const CELL_HEX_BYTES: usize = 1024;
/// The most rows the query editor returns.
pub const QUERY_ROWS: u32 = 1000;
/// The longest a statement may run, in seconds. The server enforces it with
/// `statement_timeout`; the driver enforces it again a little later, so the
/// server's own message wins when it can give one.
pub const QUERY_SECONDS: u64 = 30;
/// Separates the parts of a list the catalog queries build with `string_agg`.
const SEP: char = '\u{1f}';

/// Pool settings, public so tests can check the read-only default on the real thing.
pub fn pool_options() -> PgPoolOptions {
    pool_options_with(QUERY_SECONDS)
}

fn pool_options_with(query_seconds: u64) -> PgPoolOptions {
    PgPoolOptions::new()
        .max_connections(4)
        // Fail fast: a wrong host should show an error in seconds.
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(move |conn, _meta| {
            Box::pin(async move {
                // Every transaction on this connection starts read-only. Each statement
                // also opens its own explicit read-only transaction (see `run`), which
                // holds even where a pooler loses session settings.
                conn.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")
                    .await?;
                let timeout = format!("SET statement_timeout = {}", query_seconds * 1000);
                conn.execute(timeout.as_str()).await?;
                // Shows up in pg_stat_activity, so an admin can see who is reading.
                conn.execute("SET application_name = 'Fogtrail'").await?;
                Ok(())
            })
        })
}

/// Connection options for a saved profile. The password is passed separately
/// because it lives in the keychain, not in the profile.
pub fn options(profile: &Profile, password: Option<&str>) -> PgConnectOptions {
    let mut o = PgConnectOptions::new_without_pgpass()
        .host(profile.host.trim())
        .port(profile.port)
        .ssl_mode(ssl_mode(profile.ssl_mode.as_deref()));
    if let Some(u) = profile
        .username
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty())
    {
        o = o.username(u);
    }
    if let Some(p) = password.filter(|p| !p.is_empty()) {
        o = o.password(p);
    }
    if let Some(d) = profile
        .dbname
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        o = o.database(d);
    }
    o
}

/// `disable` means off. `require` encrypts without checking who answers. `verify-full`
/// also checks the certificate and the host name. Anything unset is `require`.
fn ssl_mode(mode: Option<&str>) -> PgSslMode {
    match mode {
        Some("disable") => PgSslMode::Disable,
        Some("verify-full") => PgSslMode::VerifyFull,
        _ => PgSslMode::Require,
    }
}

pub struct PostgresDriver {
    options: PgConnectOptions,
    address: String,
    pool: OnceCell<PgPool>,
    /// Statements in flight: the editor's run id and the server's process id, so a
    /// cancel can ask the right backend to stop.
    running: Arc<Mutex<HashMap<String, i32>>>,
    query_seconds: u64,
}

impl PostgresDriver {
    pub fn new(options: PgConnectOptions) -> Self {
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
    async fn pool(&self) -> Result<&PgPool, AppError> {
        self.pool
            .get_or_try_init(|| async {
                pool_options_with(self.query_seconds)
                    .connect_with(self.options.clone())
                    .await
                    .map_err(|e| self.err(e))
            })
            .await
    }

    fn err(&self, e: sqlx::Error) -> AppError {
        to_app_error(e, &self.address)
    }

    /// Fails with a plain message when the table doesn't exist or isn't visible.
    /// Returns `"table"`, `"view"`, `"matview"` or `"foreign"`.
    async fn kind_of(&self, schema: &str, table: &str) -> Result<String, AppError> {
        let pool = self.pool().await?;
        let row = sqlx::query(
            "SELECT c.relkind::text FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname::text = $1 AND c.relname::text = $2 \
               AND c.relkind IN ('r', 'p', 'v', 'm', 'f')",
        )
        .bind(schema)
        .bind(table)
        .fetch_optional(pool)
        .await
        .map_err(|e| self.err(e))?;
        match row.and_then(|r| text(&r, 0)) {
            Some(k) => Ok(kind_name(&k).to_string()),
            None => Err(AppError::InvalidArgument(format!(
                "There is no table {} in {}.",
                quote_ident(table),
                quote_ident(schema)
            ))),
        }
    }
}

#[async_trait]
impl Driver for PostgresDriver {
    fn describe(&self) -> ConnectionInfo {
        ConnectionInfo {
            driver: "PostgreSQL".to_string(),
            address: self.address.clone(),
            database: 0,
            store: "sql".to_string(),
        }
    }

    async fn probe(&self) -> Result<Probe, AppError> {
        let pool = self.pool().await?;
        let row = sqlx::query("SELECT version()::text")
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
impl SqlDriver for PostgresDriver {
    async fn list_schemas(&self) -> Result<Vec<SchemaInfo>, AppError> {
        let pool = self.pool().await?;
        let rows = sqlx::query(
            "SELECT nspname::text FROM pg_namespace \
             WHERE nspname !~ '^pg_temp_' AND nspname !~ '^pg_toast_temp_' \
             ORDER BY nspname",
        )
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        Ok(rows
            .iter()
            .filter_map(|r| text(r, 0))
            .map(|name| SchemaInfo {
                system: is_system_schema(&name),
                name,
            })
            .collect())
    }

    async fn list_tables(&self, schema: &str) -> Result<Vec<TableInfo>, AppError> {
        let pool = self.pool().await?;
        let rows = sqlx::query(
            "SELECT c.relname::text, c.relkind::text, c.reltuples::bigint::text \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname::text = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') \
             ORDER BY c.relname",
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
                // `reltuples` is -1 until the table has been analyzed, and views have none.
                let estimated_rows = if kind == "view" {
                    None
                } else {
                    text(r, 2)
                        .and_then(|n| n.parse::<i64>().ok())
                        .and_then(|n| u64::try_from(n).ok())
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
            "SELECT obj_description(c.oid, 'pg_class') FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname::text = $1 AND c.relname::text = $2",
        )
        .bind(schema)
        .bind(table)
        .fetch_one(pool)
        .await
        .map_err(|e| self.err(e))?;
        let columns = sqlx::query(
            "SELECT a.attname::text, format_type(a.atttypid, a.atttypmod), \
                    (NOT a.attnotnull)::text, pg_get_expr(d.adbin, d.adrelid), \
                    a.attidentity::text, a.attgenerated::text, \
                    col_description(a.attrelid, a.attnum), \
                    EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid \
                              AND i.indisprimary AND a.attnum = ANY (i.indkey))::text, \
                    EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid \
                              AND i.indisunique AND NOT i.indisprimary AND i.indnatts = 1 \
                              AND a.attnum = ANY (i.indkey))::text \
             FROM pg_attribute a \
             JOIN pg_class c ON c.oid = a.attrelid \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             WHERE n.nspname::text = $1 AND c.relname::text = $2 \
               AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY a.attnum",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        let index_rows = sqlx::query(
            "SELECT ic.relname::text, i.indisunique::text, am.amname::text, \
                    (i.indpred IS NOT NULL)::text, i.indisprimary::text, \
                    (SELECT string_agg(pg_get_indexdef(i.indexrelid, k, true), chr(31) ORDER BY k) \
                       FROM generate_series(1, i.indnkeyatts) k), \
                    pg_get_indexdef(i.indexrelid) \
             FROM pg_index i \
             JOIN pg_class ic ON ic.oid = i.indexrelid \
             JOIN pg_class c ON c.oid = i.indrelid \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_am am ON am.oid = ic.relam \
             WHERE n.nspname::text = $1 AND c.relname::text = $2 \
             ORDER BY i.indisprimary DESC, ic.relname",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        let fk_rows = sqlx::query(
            "SELECT con.conname::text, \
                    (SELECT string_agg(a.attname::text, chr(31) ORDER BY k.ord) \
                       FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord) \
                       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum), \
                    rn.nspname::text, rc.relname::text, \
                    (SELECT string_agg(a.attname::text, chr(31) ORDER BY k.ord) \
                       FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord) \
                       JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) \
             FROM pg_constraint con \
             JOIN pg_class c ON c.oid = con.conrelid \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_class rc ON rc.oid = con.confrelid \
             JOIN pg_namespace rn ON rn.oid = rc.relnamespace \
             WHERE con.contype = 'f' AND n.nspname::text = $1 AND c.relname::text = $2 \
             ORDER BY con.conname",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;

        Ok(TableStructure {
            kind,
            engine: None,
            comment: text(&meta, 0).filter(|c| !c.is_empty()),
            columns: columns
                .iter()
                .map(|r| ColumnInfo {
                    name: text(r, 0).unwrap_or_default(),
                    data_type: text(r, 1).unwrap_or_default(),
                    nullable: text(r, 2).as_deref() == Some("true"),
                    key: column_key(text(r, 7).as_deref(), text(r, 8).as_deref()),
                    default: text(r, 3),
                    extra: column_extra(text(r, 4).as_deref(), text(r, 5).as_deref()),
                    comment: text(r, 6).filter(|c| !c.is_empty()),
                })
                .collect(),
            indexes: index_rows
                .iter()
                .map(|r| IndexInfo {
                    definition: text(r, 6),
                    name: text(r, 0).unwrap_or_default(),
                    unique: text(r, 1).as_deref() == Some("true"),
                    columns: text(r, 5)
                        .map(|c| c.split(SEP).map(str::to_string).collect())
                        .unwrap_or_default(),
                    index_type: index_type(
                        &text(r, 2).unwrap_or_default(),
                        text(r, 3).as_deref() == Some("true"),
                    ),
                })
                .collect(),
            foreign_keys: fk_rows
                .iter()
                .map(|r| ForeignKeyInfo {
                    name: text(r, 0).unwrap_or_default(),
                    columns: split_list(text(r, 1)),
                    ref_schema: text(r, 2).unwrap_or_default(),
                    ref_table: text(r, 3).unwrap_or_default(),
                    ref_columns: split_list(text(r, 4)),
                })
                .collect(),
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
        let count = if count == 0 { PAGE_ROWS } else { count }.min(PAGE_ROWS_MAX);
        let pk = self.primary_key(schema, table).await?;
        let filtered = view.filter.as_deref().is_some_and(|f| !f.trim().is_empty());
        let sorted = view.sort_column.is_some();
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
        let sql = if filtered || sorted {
            let filter = view
                .filter
                .as_deref()
                .map(str::trim)
                .filter(|f| !f.is_empty());
            view_sql(schema, table, &pk, offset, count, filter, sort)
        } else {
            page_sql(schema, table, &pk, offset, count)
        };
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let run_id = format!("rows-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        // A typed filter goes through the guard along with the rest of the statement.
        // The statement without one is built here from real names only.
        let result = self.run(&sql, None, &run_id, filtered).await?;
        let has_more = result.rows.len() > count as usize;
        let mut rows = result.rows;
        rows.truncate(count as usize);
        // An empty page has no row to read the column names from.
        let columns = if result.columns.is_empty() {
            self.column_names(schema, table).await?
        } else {
            result.columns
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
        self.run(sql, schema, run_id, true).await
    }

    async fn cancel_query(&self, run_id: &str) -> Result<(), AppError> {
        let pid = self
            .running
            .lock()
            .ok()
            .and_then(|m| m.get(run_id).copied());
        if let Some(pid) = pid {
            self.cancel(pid).await;
        }
        Ok(())
    }
}

impl PostgresDriver {
    /// Runs one statement inside its own read-only transaction, which is always rolled
    /// back. `guarded` sends the text through `sql_guard` first; only SQL this module
    /// built from real names may skip it.
    async fn run(
        &self,
        sql: &str,
        schema: Option<&str>,
        run_id: &str,
        guarded: bool,
    ) -> Result<QueryResult, AppError> {
        // Nothing reaches the server until the guard has said yes.
        if guarded {
            sql_guard::check(sql, Dialect::Postgres)?;
        }
        let pool = self.pool().await?;
        let mut conn = pool.acquire().await.map_err(|e| self.err(e))?;
        let started = Instant::now();

        conn.execute("BEGIN READ ONLY")
            .await
            .map_err(|e| self.err(e))?;
        // Unqualified table names mean the schema open in the UI. `SET LOCAL` lasts for
        // this transaction only, so a pooled connection never carries it to the next
        // statement. The name is quoted, and the server refuses nothing it doesn't know:
        // an unknown schema just means "relation does not exist" below.
        if let Some(schema) = schema.map(str::trim).filter(|s| !s.is_empty()) {
            let set_path = format!("SET LOCAL search_path TO {}", quote_ident(schema));
            conn.execute(set_path.as_str())
                .await
                .map_err(|e| self.err(e))?;
        }
        let pid: i32 = sqlx::query("SELECT pg_backend_pid()::text")
            .fetch_one(&mut *conn)
            .await
            .map_err(|e| self.err(e))
            .map(|r| text(&r, 0).and_then(|p| p.parse().ok()).unwrap_or(0))?;
        let _registered = Registered::new(&self.running, run_id, pid);

        let read = read_rows(&mut conn, sql);
        let outcome =
            match tokio::time::timeout(Duration::from_secs(self.query_seconds + 2), read).await {
                Ok(done) => done,
                Err(_) => {
                    // The deadline passed without a reply: stop the statement on the server
                    // and drop this connection, which is mid-statement.
                    self.cancel(pid).await;
                    drop(conn.detach());
                    return Err(timed_out(self.query_seconds));
                }
            };
        let (columns, rows, truncated) = match outcome {
            Ok(v) => v,
            Err(e) => {
                // The transaction is aborted. Rolling back puts the connection back in order.
                let _ = conn.execute("ROLLBACK").await;
                return Err(self.query_error(e));
            }
        };
        if truncated {
            // Stopped reading with rows still on the wire, so this connection can't be
            // reused. Detach it and let the pool open a fresh one; the server rolls back.
            drop(conn.detach());
        } else {
            let _ = conn.execute("ROLLBACK").await;
        }
        Ok(QueryResult {
            columns,
            rows,
            truncated,
            row_limit: QUERY_ROWS,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }

    /// Asks the backend with this process id to stop its statement, from another
    /// connection. Best effort: if it fails, the deadline still ends the wait.
    async fn cancel(&self, pid: i32) {
        if pid == 0 {
            return;
        }
        if let Ok(pool) = self.pool().await {
            let _ = sqlx::query("SELECT pg_cancel_backend($1)")
                .bind(pid)
                .execute(pool)
                .await;
        }
    }

    /// The server's own words, except for the two ways a statement is stopped on purpose.
    fn query_error(&self, e: sqlx::Error) -> AppError {
        if let sqlx::Error::Database(db) = &e
            && db.code().as_deref() == Some("57014")
        {
            // 57014: the statement was cancelled, by the time limit or by a person.
            return if db.message().contains("statement timeout") {
                timed_out(self.query_seconds)
            } else {
                AppError::Sql("Stopped.".to_string())
            };
        }
        self.err(e)
    }

    /// Primary key column names in key order, or none.
    async fn primary_key(&self, schema: &str, table: &str) -> Result<Vec<String>, AppError> {
        let pool = self.pool().await?;
        let rows = sqlx::query(
            "SELECT a.attname::text FROM pg_index i \
             JOIN pg_class c ON c.oid = i.indrelid \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey) \
             WHERE i.indisprimary AND n.nspname::text = $1 AND c.relname::text = $2 \
             ORDER BY array_position(i.indkey::int2[], a.attnum)",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| self.err(e))?;
        Ok(rows.iter().filter_map(|r| text(r, 0)).collect())
    }

    async fn column_names(&self, schema: &str, table: &str) -> Result<Vec<ResultColumn>, AppError> {
        let pool = self.pool().await?;
        let rows = sqlx::query(
            "SELECT a.attname::text, \
                    CASE WHEN t.typcategory = 'A' THEN ltrim(t.typname::text, '_') || '[]' \
                         ELSE t.typname::text END \
             FROM pg_attribute a \
             JOIN pg_class c ON c.oid = a.attrelid \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_type t ON t.oid = a.atttypid \
             WHERE n.nspname::text = $1 AND c.relname::text = $2 \
               AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY a.attnum",
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
    running: Arc<Mutex<HashMap<String, i32>>>,
    run_id: String,
}

impl Registered {
    fn new(running: &Arc<Mutex<HashMap<String, i32>>>, run_id: &str, pid: i32) -> Self {
        if let Ok(mut m) = running.lock() {
            m.insert(run_id.to_string(), pid);
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

/// Reads up to [`QUERY_ROWS`] rows, one at a time. `raw_sql` uses the simple query
/// protocol, so every value arrives as text, the same in the table view and the editor.
async fn read_rows(conn: &mut sqlx::PgConnection, sql: &str) -> Result<Rows, sqlx::Error> {
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
        && !truncated
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

fn result_columns(row: &PgRow) -> Vec<ResultColumn> {
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
    format!("\"{}\"", name.replace('"', "\"\""))
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
/// inside the parentheses, so a `--` comment at its end can't swallow the closing
/// one. `sql_guard` checks the finished statement before it is sent.
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

/// `pg_class.relkind` as the UI's word for it.
fn kind_name(relkind: &str) -> &'static str {
    match relkind {
        "v" => "view",
        "m" => "matview",
        "f" => "foreign",
        _ => "table",
    }
}

/// Built-in schemas: the catalog, the standard information schema, and TOAST.
fn is_system_schema(name: &str) -> bool {
    name == "information_schema" || name.starts_with("pg_")
}

fn column_key(primary: Option<&str>, unique: Option<&str>) -> Option<String> {
    if primary == Some("true") {
        Some("PRI".to_string())
    } else if unique == Some("true") {
        Some("UNI".to_string())
    } else {
        None
    }
}

fn column_extra(identity: Option<&str>, generated: Option<&str>) -> Option<String> {
    match (identity, generated) {
        (Some("a"), _) => Some("generated always as identity".to_string()),
        (Some("d"), _) => Some("generated by default as identity".to_string()),
        (_, Some("s")) => Some("generated stored".to_string()),
        _ => None,
    }
}

/// `btree`, or `btree · partial` for an index that covers only some rows.
fn index_type(method: &str, partial: bool) -> String {
    if partial {
        format!("{method} · partial")
    } else {
        method.to_string()
    }
}

fn split_list(list: Option<String>) -> Vec<String> {
    list.map(|l| l.split(SEP).map(str::to_string).collect())
        .unwrap_or_default()
}

/// Product and version from `SELECT version()`, such as
/// `PostgreSQL 16.4 (Debian 16.4-1.pgdg120+1) on x86_64-pc-linux-gnu, ...`.
fn detect(raw: &str) -> (String, String) {
    let mut words = raw.split_whitespace();
    let product = words.next().unwrap_or("PostgreSQL");
    let version = words.next().unwrap_or("");
    (product.to_string(), version.to_string())
}

/// A text column of a catalog query, or `None` for NULL.
fn text(row: &PgRow, i: usize) -> Option<String> {
    row.try_get::<Option<String>, _>(i).ok().flatten()
}

/// One result cell as the UI shows it.
fn cell(row: &PgRow, i: usize, type_name: &str) -> Option<String> {
    let raw = row.try_get_raw(i).ok()?;
    if raw.is_null() {
        return None;
    }
    let bytes = raw.as_bytes().ok()?;
    Some(cell_text(type_name, bytes))
}

/// Binary values arrive as `\x` hex and are shown as `0x` hex, like MySQL's. Everything
/// else is text. Both are cut to a sane size.
fn cell_text(type_name: &str, bytes: &[u8]) -> String {
    let s = String::from_utf8_lossy(bytes);
    if type_name == "BYTEA"
        && let Some(hex) = s.strip_prefix("\\x")
    {
        let keep = CELL_HEX_BYTES * 2;
        return if hex.len() > keep {
            format!("0x{}…", &hex[..keep])
        } else {
            format!("0x{hex}")
        };
    }
    if s.chars().count() > CELL_CHARS {
        let cut: String = s.chars().take(CELL_CHARS).collect();
        format!("{cut}…")
    } else {
        s.into_owned()
    }
}

/// Turns what sqlx reports into something the UI can show. The server's own
/// message is kept for statement errors; connection problems name the address.
fn to_app_error(e: sqlx::Error, address: &str) -> AppError {
    match &e {
        sqlx::Error::Database(db) => match db.code().as_deref() {
            // 28P01 wrong password, 28000 not allowed in, 3D000 no such database,
            // 53300 too many connections.
            Some("28P01" | "28000" | "3D000" | "53300") => {
                AppError::Connect(db.message().to_string())
            }
            _ => AppError::Sql(db.message().to_string()),
        },
        sqlx::Error::Tls(inner) if inner.to_string().contains("does not support TLS") => {
            AppError::Connect(format!(
                "{address} does not support TLS. If this is a local server, set SSL mode to disable."
            ))
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
    fn names_are_quoted_and_double_quotes_doubled() {
        assert_eq!(quote_ident("orders"), "\"orders\"");
        assert_eq!(quote_ident("Mixed Case"), "\"Mixed Case\"");
        assert_eq!(quote_ident("back\"quote"), "\"back\"\"quote\"");
        assert_eq!(
            quote_ident("x\"; DROP TABLE y; --"),
            "\"x\"\"; DROP TABLE y; --\""
        );
    }

    #[test]
    fn a_page_asks_for_one_extra_row_and_orders_by_the_primary_key() {
        let sql = page_sql("public", "orders", &["id".into()], 200, 100);
        assert_eq!(
            sql,
            "SELECT * FROM \"public\".\"orders\" ORDER BY \"id\" LIMIT 101 OFFSET 200"
        );
        let sql = page_sql("s", "t", &["a".into(), "b".into()], 0, 10);
        assert!(sql.contains("ORDER BY \"a\", \"b\" LIMIT 11 OFFSET 0"));
        assert!(!page_sql("s", "t", &[], 0, 10).contains("ORDER BY"));
    }

    #[test]
    fn a_filtered_page_keeps_the_filter_inside_its_own_parentheses() {
        let sql = view_sql(
            "public",
            "orders",
            &["id".into()],
            0,
            100,
            Some("status = 'paid' -- only paid"),
            Some(("total", true)),
        );
        assert_eq!(
            sql,
            "SELECT * FROM \"public\".\"orders\" WHERE (\nstatus = 'paid' -- only paid\n) \
             ORDER BY \"total\" DESC, \"id\" LIMIT 101 OFFSET 0"
        );
        // Sorting by the primary key does not list it twice.
        let sql = view_sql("s", "t", &["id".into()], 5, 10, None, Some(("id", false)));
        assert_eq!(
            sql,
            "SELECT * FROM \"s\".\"t\" ORDER BY \"id\" LIMIT 11 OFFSET 5"
        );
    }

    #[test]
    fn product_and_version_are_split_out() {
        assert_eq!(
            detect("PostgreSQL 16.4 (Debian 16.4-1.pgdg120+1) on x86_64-pc-linux-gnu"),
            ("PostgreSQL".into(), "16.4".into())
        );
        assert_eq!(detect(""), ("PostgreSQL".into(), "".into()));
    }

    #[test]
    fn relation_kinds_get_the_uis_words() {
        assert_eq!(kind_name("r"), "table");
        assert_eq!(kind_name("p"), "table");
        assert_eq!(kind_name("v"), "view");
        assert_eq!(kind_name("m"), "matview");
        assert_eq!(kind_name("f"), "foreign");
    }

    #[test]
    fn system_schemas_are_the_built_in_ones() {
        for s in ["pg_catalog", "information_schema", "pg_toast"] {
            assert!(is_system_schema(s), "{s}");
        }
        for s in ["public", "billing", "auth"] {
            assert!(!is_system_schema(s), "{s}");
        }
    }

    #[test]
    fn keys_and_extras_are_named() {
        assert_eq!(
            column_key(Some("true"), Some("false")).as_deref(),
            Some("PRI")
        );
        assert_eq!(
            column_key(Some("false"), Some("true")).as_deref(),
            Some("UNI")
        );
        assert_eq!(column_key(Some("false"), Some("false")), None);
        assert_eq!(
            column_extra(Some("a"), Some("")).as_deref(),
            Some("generated always as identity")
        );
        assert_eq!(
            column_extra(Some(""), Some("s")).as_deref(),
            Some("generated stored")
        );
        assert_eq!(column_extra(Some(""), Some("")), None);
        assert_eq!(index_type("btree", true), "btree · partial");
        assert_eq!(index_type("gin", false), "gin");
    }

    #[test]
    fn bytea_becomes_hex_and_text_stays_text() {
        assert_eq!(cell_text("BYTEA", b"\\x89504e47"), "0x89504e47");
        let big = format!("\\x{}", "ab".repeat(CELL_HEX_BYTES + 10));
        let shown = cell_text("BYTEA", big.as_bytes());
        assert!(shown.starts_with("0xabab") && shown.ends_with('…'));
        assert_eq!(cell_text("TEXT", "héllo".as_bytes()), "héllo");
        let long = "x".repeat(CELL_CHARS + 5);
        assert_eq!(
            cell_text("TEXT", long.as_bytes()).chars().count(),
            CELL_CHARS + 1
        );
    }

    #[test]
    fn connection_failures_name_the_address() {
        let e = to_app_error(sqlx::Error::PoolTimedOut, "db:5432");
        assert!(matches!(&e, AppError::Connect(m) if m.contains("db:5432")));
    }

    #[test]
    fn options_use_the_ssl_mode_the_profile_asks_for() {
        assert!(matches!(ssl_mode(None), PgSslMode::Require));
        assert!(matches!(ssl_mode(Some("require")), PgSslMode::Require));
        assert!(matches!(ssl_mode(Some("disable")), PgSslMode::Disable));
        assert!(matches!(
            ssl_mode(Some("verify-full")),
            PgSslMode::VerifyFull
        ));
        // Anything it doesn't know is the safe default, not "off".
        assert!(matches!(ssl_mode(Some("allow")), PgSslMode::Require));
    }
}
