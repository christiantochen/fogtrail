use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::connections::{Connections, TestResult};
use crate::drivers::{
    BrowseQuery, ConnectionInfo, Detail, MAX_RUN_ID, Node, Page, QueryResult, RowPage, RowView,
    SchemaInfo, ServerInfo, StreamPage, TableInfo, TableStructure,
};
use crate::error::AppError;
use crate::profiles::Profile;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let package = app.package_info();
    AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
    }
}

#[tauri::command]
pub fn list_profiles(conns: State<'_, Connections>) -> Result<Vec<Profile>, AppError> {
    conns.list()
}

#[tauri::command]
pub fn save_profile(
    conns: State<'_, Connections>,
    profile: Profile,
    password: Option<String>,
) -> Result<Profile, AppError> {
    conns.save(profile, password)
}

#[tauri::command]
pub fn delete_profile(conns: State<'_, Connections>, id: String) -> Result<(), AppError> {
    conns.delete(&id)
}

#[tauri::command]
pub async fn test_connection(
    conns: State<'_, Connections>,
    profile: Profile,
    password: Option<String>,
) -> Result<TestResult, AppError> {
    conns.test(&profile, password).await
}

#[tauri::command]
pub async fn connect(
    conns: State<'_, Connections>,
    id: String,
) -> Result<ConnectionInfo, AppError> {
    conns.connect(&id).await
}

#[tauri::command]
pub fn disconnect(conns: State<'_, Connections>) {
    conns.disconnect();
}

#[tauri::command]
pub fn connection_info(conns: State<'_, Connections>) -> Result<ConnectionInfo, AppError> {
    conns.info()
}

#[tauri::command]
pub async fn scan_keys(
    conns: State<'_, Connections>,
    pattern: Option<String>,
    cursor: Option<String>,
    count: Option<u32>,
    kind: Option<String>,
) -> Result<Page<Node>, AppError> {
    conns
        .key_value()?
        .browse(BrowseQuery {
            pattern,
            cursor,
            count: count.unwrap_or(200),
            kind,
        })
        .await
}

#[tauri::command]
pub async fn get_key(conns: State<'_, Connections>, name: String) -> Result<Detail, AppError> {
    conns.key_value()?.read(&name).await
}

#[tauri::command]
pub async fn stream_page(
    conns: State<'_, Connections>,
    name: String,
    before: String,
    count: Option<u32>,
) -> Result<StreamPage, AppError> {
    conns
        .key_value()?
        .stream_page(&name, &before, count.unwrap_or(100))
        .await
}

#[tauri::command]
pub async fn server_info(conns: State<'_, Connections>) -> Result<ServerInfo, AppError> {
    conns.server_info().await
}

#[tauri::command]
pub async fn select_database(
    conns: State<'_, Connections>,
    database: u32,
) -> Result<ConnectionInfo, AppError> {
    conns.select_database(database).await
}

#[tauri::command]
pub async fn list_schemas(conns: State<'_, Connections>) -> Result<Vec<SchemaInfo>, AppError> {
    conns.sql()?.list_schemas().await
}

#[tauri::command]
pub async fn list_tables(
    conns: State<'_, Connections>,
    schema: String,
) -> Result<Vec<TableInfo>, AppError> {
    conns.sql()?.list_tables(&schema).await
}

#[tauri::command]
pub async fn table_structure(
    conns: State<'_, Connections>,
    schema: String,
    table: String,
) -> Result<TableStructure, AppError> {
    conns.sql()?.table_structure(&schema, &table).await
}

#[tauri::command]
pub async fn table_rows(
    conns: State<'_, Connections>,
    schema: String,
    table: String,
    offset: Option<u64>,
    count: Option<u32>,
    view: Option<RowView>,
    run_id: Option<String>,
) -> Result<RowPage, AppError> {
    let mut view = view.unwrap_or_default();
    view.filter = view.filter.filter(|f| !f.trim().is_empty());
    if let Some(id) = &run_id {
        check_run_id(id)?;
    }
    conns
        .sql()?
        .table_rows(
            &schema,
            &table,
            offset.unwrap_or(0),
            count.unwrap_or(100),
            &view,
            // The screen sends its own id so a slow read can be cancelled.
            &run_id.unwrap_or_else(rows_run_id),
        )
        .await
}

/// Run ids are kept in memory while a statement runs, so their size is bounded.
fn check_run_id(id: &str) -> Result<(), AppError> {
    if id.len() > MAX_RUN_ID {
        return Err(AppError::InvalidArgument("The run id is too long.".into()));
    }
    Ok(())
}

/// An id for a read nobody asked to cancel.
fn rows_run_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("rows-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

#[tauri::command]
pub async fn run_query(
    conns: State<'_, Connections>,
    sql: String,
    schema: Option<String>,
    run_id: String,
) -> Result<QueryResult, AppError> {
    check_run_id(&run_id)?;
    conns
        .sql()?
        .run_query(&sql, schema.as_deref(), &run_id)
        .await
}

#[tauri::command]
pub async fn cancel_query(conns: State<'_, Connections>, run_id: String) -> Result<(), AppError> {
    check_run_id(&run_id)?;
    conns.sql()?.cancel_query(&run_id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_id_of_the_screens_own_size_passes() {
        assert!(check_run_id("rows-ui-0f8fad5b-d9cb-469f-a165-70867728950e").is_ok());
        assert!(check_run_id(&"x".repeat(MAX_RUN_ID)).is_ok());
    }

    #[test]
    fn a_longer_run_id_is_refused() {
        assert!(matches!(
            check_run_id(&"x".repeat(MAX_RUN_ID + 1)),
            Err(AppError::InvalidArgument(_))
        ));
    }
}
