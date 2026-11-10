// Mirrors the serde output of src-tauri/src/drivers/mod.rs (camelCase).

export interface ConnectionInfo {
  driver: string;
  address: string;
  database: number;
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
  tls: boolean;
}

export interface TestResult {
  product: string;
  version: string;
  keyCount: number;
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
