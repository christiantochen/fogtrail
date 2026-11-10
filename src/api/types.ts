// Mirrors the serde output of src-tauri/src/drivers/mod.rs (camelCase).

export interface ConnectionInfo {
  driver: string;
  address: string;
  database: number;
  /** Which screen to show: "keyValue" for Redis, Valkey and Dragonfly. */
  store: "keyValue" | "sql";
}

export interface KeyNode {
  name: string;
  kind: string;
  ttlSeconds: number | null;
  /** When the app scanned this key (ms). Set by the app, not the backend. */
  scannedAt?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MapEntry {
  key: string;
  value: string;
}

export type Value =
  | { type: "text"; text: string; truncated: boolean }
  | { type: "binary"; hex: string; length: number; truncated: boolean }
  | { type: "map"; entries: MapEntry[]; total: number; truncated: boolean }
  | { type: "list"; items: string[]; total: number; truncated: boolean }
  | {
      type: "table";
      columns: string[];
      rows: string[][];
      total: number;
      truncated: boolean;
    }
  | {
      type: "stream";
      /** Newest first. */
      entries: StreamEntry[];
      total: number;
      /** Pass to `streamPage` for older entries; null at the start. */
      nextBefore: string | null;
      groups: StreamGroup[];
    }
  | { type: "unsupported"; kind: string };

export interface StreamEntry {
  id: string;
  timeMs: number | null;
  fields: MapEntry[];
}

export interface StreamGroup {
  name: string;
  consumers: number;
  pending: number;
  lastDeliveredId: string;
}

export interface StreamPage {
  entries: StreamEntry[];
  nextBefore: string | null;
}

export interface Detail {
  name: string;
  kind: string;
  ttlSeconds: number | null;
  encoding: string | null;
  sizeBytes: number | null;
  value: Value;
  readWith: string[];
}

export interface AppError {
  kind:
    | "connect"
    | "notFound"
    | "invalidArgument"
    | "notConnected"
    | "storage"
    | "secret"
    | "redis"
    | "sql"
    | "unknown";
  message: string;
}

export interface Profile {
  /** Empty until the profile has been saved. */
  id: string;
  name: string;
  driver: string;
  host: string;
  port: number;
  username: string | null;
  database: number;
  /** Default schema (MySQL database name). Null for Redis. */
  schema: string | null;
  tls: boolean;
}

export interface TestResult {
  product: string;
  version: string;
  /** Null for stores that don't count keys (MySQL). */
  keyCount: number | null;
}

export interface DatabaseInfo {
  index: number;
  keys: number;
  expires: number;
}

export interface ServerInfo {
  product: string;
  version: string;
  mode: string | null;
  role: string | null;
  os: string | null;
  uptimeSeconds: number | null;
  usedMemory: number | null;
  /** 0 means no limit. */
  maxMemory: number | null;
  connectedClients: number | null;
  opsPerSec: number | null;
  hits: number | null;
  misses: number | null;
  databases: DatabaseInfo[];
  /** How many databases the server has; null when it does not say. */
  databaseCount: number | null;
}

export interface SchemaInfo {
  name: string;
  /** Built-in schemas such as mysql and information_schema. */
  system: boolean;
}

export interface TableInfo {
  name: string;
  kind: "table" | "view";
  /** The server's own estimate, never an exact count. Null for views. */
  estimatedRows: number | null;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  key: string | null;
  default: string | null;
  extra: string | null;
  comment: string | null;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
  indexType: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
}

export interface TableStructure {
  kind: "table" | "view";
  engine: string | null;
  comment: string | null;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export interface ResultColumn {
  name: string;
  typeName: string;
}

/** A cell is null for SQL NULL, so NULL and an empty string stay different. */
export interface RowPage {
  columns: ResultColumn[];
  rows: (string | null)[][];
  offset: number;
  hasMore: boolean;
}
