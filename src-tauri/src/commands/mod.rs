use serde::Serialize;
use tauri::{AppHandle, State};

use crate::connections::{Connections, TestResult};
use crate::drivers::{
    BrowseQuery, ConnectionInfo, Detail, Node, Page, QueryResult, RowPage, SchemaInfo, ServerInfo,
    StreamPage, TableInfo, TableStructure,
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
) -> Result<RowPage, AppError> {
    conns
        .sql()?
        .table_rows(&schema, &table, offset.unwrap_or(0), count.unwrap_or(100))
        .await
}

#[tauri::command]
pub async fn run_query(
    conns: State<'_, Connections>,
    sql: String,
    schema: Option<String>,
    run_id: String,
) -> Result<QueryResult, AppError> {
    conns
        .sql()?
        .run_query(&sql, schema.as_deref(), &run_id)
        .await
}

#[tauri::command]
pub async fn cancel_query(conns: State<'_, Connections>, run_id: String) -> Result<(), AppError> {
    conns.sql()?.cancel_query(&run_id).await
}
