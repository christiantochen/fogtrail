import type { Profile } from "../api/types";

/** Form fields as typed: numbers stay strings until validated. */
export interface Draft {
  name: string;
  host: string;
  port: string;
  username: string;
  database: string;
  tls: boolean;
}

export const emptyDraft = (): Draft => ({
  name: "",
  host: "127.0.0.1",
  port: "6379",
  username: "",
  database: "0",
  tls: false,
});

export const draftOf = (p: Profile): Draft => ({
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
  if (!wholeNumber(d.database) || Number(d.database) > 1023)
    e.database = "0 or more.";
  return e;
}

/** Only call with a draft that passed {@link validate}. */
export function toProfile(d: Draft, id = "", driver = "redis"): Profile {
  const username = d.username.trim();
  return {
    id,
    driver,
    name: d.name.trim(),
    host: d.host.trim(),
    port: Number(d.port),
    username: username === "" ? null : username,
    database: Number(d.database),
    tls: d.tls,
  };
}
