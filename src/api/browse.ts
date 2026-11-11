import { invoke } from "@tauri-apps/api/core";
import { toAppError } from "./errors";
import type {
  ConnectionInfo,
  Detail,
  KeyNode,
  Page,
  Profile,
  QueryResult,
  RowPage,
  RowView,
  SchemaInfo,
  ServerInfo,
  StreamPage,
  TableInfo,
  TableStructure,
  TestResult,
} from "./types";

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toAppError(err);
  }
}

export const listProfiles = () => call<Profile[]>("list_profiles");

export const saveProfile = (profile: Profile, password: string | null) =>
  call<Profile>("save_profile", { profile, password });

export const deleteProfile = (id: string) =>
  call<void>("delete_profile", { id });

export const testConnection = (profile: Profile, password: string | null) =>
  call<TestResult>("test_connection", { profile, password });

export const connect = (id: string) => call<ConnectionInfo>("connect", { id });

export const disconnect = () => call<void>("disconnect");

export const scanKeys = (args: {
  pattern?: string;
  cursor?: string | null;
  count?: number;
  /** Only keys of this type: string, hash, list, set, zset or stream. */
  kind?: string | null;
}) => call<Page<KeyNode>>("scan_keys", args);

export const getKey = (name: string) => call<Detail>("get_key", { name });

export const streamPage = (name: string, before: string, count?: number) =>
  call<StreamPage>("stream_page", { name, before, count });

export const serverInfo = () => call<ServerInfo>("server_info");

export const selectDatabase = (database: number) =>
  call<ConnectionInfo>("select_database", { database });

export const listSchemas = () => call<SchemaInfo[]>("list_schemas");

export const listTables = (schema: string) =>
  call<TableInfo[]>("list_tables", { schema });

export const tableStructure = (schema: string, table: string) =>
  call<TableStructure>("table_structure", { schema, table });

export const tableRows = (
  schema: string,
  table: string,
  offset: number,
  view?: RowView,
  count?: number,
) => call<RowPage>("table_rows", { schema, table, offset, view, count });

/** Runs one read-only statement. `runId` lets `cancelQuery` stop it. */
export const runQuery = (sql: string, schema: string | null, runId: string) =>
  call<QueryResult>("run_query", { sql, schema, runId });

export const cancelQuery = (runId: string) =>
  call<void>("cancel_query", { runId });
