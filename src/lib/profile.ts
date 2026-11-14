import type { Profile } from "../api/types";

export type DriverId = "redis" | "mysql" | "postgres";

/** The ways to connect with TLS to PostgreSQL, as the `sslmode` setting names them. */
export type SslMode = "disable" | "require" | "verify-full";

export const SSL_MODES: { value: SslMode; label: string; meta: string }[] = [
  {
    value: "require",
    label: "Require",
    meta: "Encrypt, don’t check who answers",
  },
  {
    value: "verify-full",
    label: "Verify full",
    meta: "Encrypt and check the certificate and host",
  },
  { value: "disable", label: "Disable", meta: "No encryption (local servers)" },
];

export const DRIVERS: { id: DriverId; label: string; blurb: string }[] = [
  {
    id: "redis",
    label: "Redis",
    blurb: "Keys and values. Also Valkey and Dragonfly.",
  },
  {
    id: "mysql",
    label: "MySQL",
    blurb: "Tables, rows and read-only SQL queries.",
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    blurb: "Schemas, tables, rows and read-only SQL queries.",
  },
];

export const defaultPort = (driver: DriverId) =>
  driver === "mysql" ? 3306 : driver === "postgres" ? 5432 : 6379;

/** Shown in lists and badges. */
export const driverLabel = (driver: string) =>
  driver === "mysql" ? "MySQL" : driver === "postgres" ? "PostgreSQL" : "Redis";

/** Form fields as typed: numbers stay strings until validated. */
export interface Draft {
  driver: DriverId;
  name: string;
  host: string;
  port: string;
  username: string;
  /** Redis database number. */
  database: string;
  /** MySQL database name. Blank means none chosen yet. */
  schema: string;
  tls: boolean;
  /** PostgreSQL database name. */
  dbname: string;
  /** PostgreSQL SSL mode. */
  sslMode: SslMode;
}

export const emptyDraft = (driver: DriverId = "redis"): Draft => ({
  driver,
  name: "",
  host: "127.0.0.1",
  port: String(defaultPort(driver)),
  username: "",
  database: "0",
  schema: "",
  tls: false,
  dbname: "",
  sslMode: "require",
});

export const draftOf = (p: Profile): Draft => ({
  driver: p.driver === "mysql" || p.driver === "postgres" ? p.driver : "redis",
  schema: p.schema ?? "",
  dbname: p.dbname ?? "",
  sslMode:
    p.sslMode === "disable" || p.sslMode === "verify-full"
      ? p.sslMode
      : "require",
  name: p.name,
  host: p.host,
  port: String(p.port),
  username: p.username ?? "",
  database: String(p.database),
  tls: p.tls,
});

export type Errors = Partial<Record<keyof Draft, string>>;

const wholeNumber = (s: string) => /^\d+$/.test(s.trim());

export function validate(d: Draft): Errors {
  const e: Errors = {};
  if (!d.name.trim()) e.name = "Give the connection a name.";
  if (!d.host.trim()) e.host = "Enter a host.";
  if (!wholeNumber(d.port) || Number(d.port) < 1 || Number(d.port) > 65535) {
    e.port = "1 to 65535.";
  }
  if (
    d.driver === "redis" &&
    (!wholeNumber(d.database) || Number(d.database) > 1023)
  )
    e.database = "0 or more.";
  if (d.driver !== "redis" && !d.username.trim()) e.username = "Enter a user.";
  if (d.driver === "postgres" && !d.dbname.trim())
    e.dbname = "Enter a database.";
  if (d.schema.trim().length > 64) e.schema = "64 characters at most.";
  if (d.dbname.trim().length > 63) e.dbname = "63 characters at most.";
  return e;
}

/** Only call with a draft that passed {@link validate}. */
export function toProfile(d: Draft, id = ""): Profile {
  const username = d.username.trim();
  const mysql = d.driver === "mysql";
  return {
    id,
    driver: d.driver,
    name: d.name.trim(),
    host: d.host.trim(),
    port: Number(d.port),
    username: username === "" ? null : username,
    database: d.driver === "redis" ? Number(d.database) : 0,
    schema: mysql && d.schema.trim() !== "" ? d.schema.trim() : null,
    // PostgreSQL has its own SSL mode; the switch is for the others.
    tls: d.driver === "postgres" ? d.sslMode !== "disable" : d.tls,
    dbname: d.driver === "postgres" ? d.dbname.trim() : null,
    sslMode: d.driver === "postgres" ? d.sslMode : null,
  };
}
