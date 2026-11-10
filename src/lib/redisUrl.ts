import { defaultPort, type Draft, type DriverId } from "./profile";

/** What a Redis URL says. A field the URL does not mention is left out. */
export interface ParsedUrl {
  host: string;
  /** Left out when the URL has no port; the caller applies 6379. */
  port?: number;
  /** "" means the URL has a user section with no name (`:pass@host`), so legacy AUTH. */
  username?: string;
  password?: string;
  /** Redis: left out when the URL has no `/2` path; the caller applies 0. */
  database?: number;
  /** MySQL: the database name in the path, left out when there is none. */
  schema?: string;
  /** `rediss://` is TLS. For MySQL, `?ssl-mode=required` and the like. */
  tls: boolean;
}

export type ParseResult =
  { ok: true; value: ParsedUrl } | { ok: false; error: string };

export const DEFAULT_PORT = 6379;

/** What each driver's URLs look like, for messages. */
const URL_STYLE: Record<DriverId, { name: string; schemes: string[] }> = {
  redis: { name: "Redis", schemes: ["redis", "rediss"] },
  mysql: { name: "MySQL", schemes: ["mysql"] },
};

/** True for anything that looks like `scheme://…`, so a plain hostname is never mistaken for a URL. */
export const looksLikeUrl = (s: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(s.trim());

const fail = (error: string): ParseResult => ({ ok: false, error });

function decode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * Reads `redis://[user[:password]@]host[:port][/db]` and the `rediss://` (TLS) form.
 * Username and password are percent-decoded. A query string or fragment is ignored.
 */
export const parseRedisUrl = (input: string): ParseResult =>
  parseConnectionUrl(input, "redis");

/** Reads `mysql://[user[:password]@]host[:port][/schema][?ssl-mode=required]`. */
export const parseMysqlUrl = (input: string): ParseResult =>
  parseConnectionUrl(input, "mysql");

/** `?ssl-mode=required`, `?tls=true` and similar, as drivers and tools write them. */
function mysqlTls(query: string): boolean {
  for (const pair of query.split("&")) {
    const [k, v = ""] = pair.split("=");
    const key = k.toLowerCase();
    const val = v.toLowerCase();
    if (["ssl-mode", "sslmode", "ssl_mode"].includes(key))
      return [
        "required",
        "verify_ca",
        "verify_identity",
        "verify-full",
      ].includes(val);
    if (["tls", "ssl", "usessl"].includes(key))
      return ["true", "1", "yes", "required"].includes(val);
  }
  return false;
}

export function parseConnectionUrl(
  input: string,
  driver: DriverId,
): ParseResult {
  const style = URL_STYLE[driver];
  const text = input.trim();
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/is.exec(text);
  const use = style.schemes.map((x) => `${x}://`).join(" or ");
  if (!m) return fail(`That is not a ${style.name} URL. Start it with ${use}.`);
  const scheme = m[1].toLowerCase();
  if (!style.schemes.includes(scheme))
    return fail(`Unsupported scheme “${scheme}://”. Use ${use}.`);
  const rest = m[2];

  // The last "@" ends the user section, so a raw "@" inside a password still works.
  const at = rest.lastIndexOf("@");
  const tailAt = rest.slice(at + 1).search(/[/?#]/);
  const end = tailAt === -1 ? rest.length : at + 1 + tailAt;
  const userinfo = at === -1 ? null : rest.slice(0, at);
  const hostPort = rest.slice(at + 1, end);
  const path = rest.slice(end);

  const value: ParsedUrl = { host: "", tls: scheme === "rediss" };
  if (driver === "mysql")
    value.tls = mysqlTls(rest.split("?")[1]?.split("#")[0] ?? "");

  if (userinfo !== null) {
    const colon = userinfo.indexOf(":");
    const rawUser = colon === -1 ? userinfo : userinfo.slice(0, colon);
    const user = decode(rawUser);
    if (user === null) return fail("The username has a broken % escape.");
    value.username = user;
    if (colon !== -1) {
      const pass = decode(userinfo.slice(colon + 1));
      if (pass === null) return fail("The password has a broken % escape.");
      value.password = pass;
    }
  }

  // [::1]:6379 for IPv6, host:port otherwise.
  let host = hostPort;
  let rawPort = "";
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close === -1)
      return fail("The host has an opening [ with no closing ].");
    host = hostPort.slice(1, close);
    const after = hostPort.slice(close + 1);
    if (after !== "" && !after.startsWith(":"))
      return fail("Unexpected text after the host.");
    rawPort = after.slice(1);
  } else {
    const colon = hostPort.lastIndexOf(":");
    if (colon !== -1) {
      host = hostPort.slice(0, colon);
      rawPort = hostPort.slice(colon + 1);
    }
  }
  if (host === "") return fail("The URL has no host.");
  value.host = host;

  if (rawPort !== "") {
    const port = /^\d+$/.test(rawPort) ? Number(rawPort) : NaN;
    if (!(port >= 1 && port <= 65535))
      return fail(`Port “${rawPort}” is not valid. Use 1 to 65535.`);
    value.port = port;
  }

  if (path.startsWith("/")) {
    const raw = path.slice(1).split(/[?#]/)[0];
    if (raw !== "") {
      if (driver === "mysql") {
        const schema = decode(raw);
        if (schema === null)
          return fail("The database name has a broken % escape.");
        value.schema = schema;
      } else {
        if (!/^\d+$/.test(raw))
          return fail(`Database “${raw}” is not a number.`);
        value.database = Number(raw);
      }
    }
  }
  return { ok: true, value };
}

/** Names of the form fields a URL filled, for the "Filled from URL" hint. */
export type Filled = (
  "host" | "port" | "username" | "password" | "database" | "schema" | "tls"
)[];

/**
 * Puts a parsed URL into the form. Fields the URL does not mention keep their value,
 * except port and database when `fresh` (a new connection), which take the Redis defaults.
 */
export function applyUrl(
  draft: Draft,
  password: string,
  u: ParsedUrl,
  fresh: boolean,
): { draft: Draft; password: string; filled: Filled } {
  const filled: Filled = ["host"];
  const next: Draft = { ...draft, host: u.host, tls: u.tls };
  filled.push("tls");
  if (u.port !== undefined || fresh) {
    next.port = String(u.port ?? defaultPort(draft.driver));
    filled.push("port");
  }
  if (draft.driver === "mysql") {
    if (u.schema !== undefined || fresh) {
      next.schema = u.schema ?? "";
      filled.push("schema");
    }
  } else if (u.database !== undefined || fresh) {
    next.database = String(u.database ?? 0);
    filled.push("database");
  }
  if (u.username !== undefined) {
    next.username = u.username;
    filled.push("username");
  }
  let pw = password;
  if (u.password !== undefined) {
    pw = u.password;
    filled.push("password");
  }
  return { draft: next, password: pw, filled };
}

/** Builds `redis://…` back from the form. The password is left out unless `withPassword`. */
export function buildRedisUrl(
  d: Draft,
  password: string,
  withPassword: boolean,
): string {
  const user = d.username.trim();
  let auth = "";
  if (withPassword && password !== "") {
    auth = `${user === "" ? "" : encodeURIComponent(user)}:${encodeURIComponent(password)}@`;
  } else if (user !== "") {
    auth = `${encodeURIComponent(user)}@`;
  }
  const host = d.host.trim();
  const h = host.includes(":") ? `[${host}]` : host;
  const db = d.database.trim();
  return `${d.tls ? "rediss" : "redis"}://${auth}${h}:${d.port.trim()}${db !== "" && db !== "0" ? `/${db}` : ""}`;
}

/** Builds `mysql://…` back from the form. The password is left out unless `withPassword`. */
export function buildMysqlUrl(
  d: Draft,
  password: string,
  withPassword: boolean,
): string {
  const user = d.username.trim();
  let auth = "";
  if (withPassword && password !== "") {
    auth = `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`;
  } else if (user !== "") {
    auth = `${encodeURIComponent(user)}@`;
  }
  const host = d.host.trim();
  const h = host.includes(":") ? `[${host}]` : host;
  const schema = d.schema.trim();
  const path = schema !== "" ? `/${encodeURIComponent(schema)}` : "";
  return `mysql://${auth}${h}:${d.port.trim()}${path}${d.tls ? "?ssl-mode=required" : ""}`;
}

/** The form as a URL, in the style of its driver. */
export const buildConnectionUrl = (
  d: Draft,
  password: string,
  withPassword: boolean,
): string =>
  d.driver === "mysql"
    ? buildMysqlUrl(d, password, withPassword)
    : buildRedisUrl(d, password, withPassword);
