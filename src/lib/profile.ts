import type { Profile } from "../api/types";

export type DriverId = "redis" | "mysql";

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
];

export const defaultPort = (driver: DriverId) =>
  driver === "mysql" ? 3306 : 6379;

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
});

export const draftOf = (p: Profile): Draft => ({
  driver: p.driver === "mysql" ? "mysql" : "redis",
  schema: p.schema ?? "",
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
  if (d.driver === "mysql" && !d.username.trim()) e.username = "Enter a user.";
  if (d.schema.trim().length > 64) e.schema = "64 characters at most.";
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
    database: mysql ? 0 : Number(d.database),
    schema: mysql && d.schema.trim() !== "" ? d.schema.trim() : null,
    tls: d.tls,
  };
}
