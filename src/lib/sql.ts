import type {
  ColumnInfo,
  ResultColumn,
  SchemaInfo,
  TableInfo,
} from "../api/types";

/** Which SQL the open connection speaks. Decides quoting and what the editor suggests. */
export type SqlDialect = "mysql" | "postgres";

/** The dialect for a connection's driver name, as `describe()` reports it. */
export const sqlDialectOf = (driver: string | undefined): SqlDialect =>
  driver?.startsWith("PostgreSQL") ? "postgres" : "mysql";

/** Rows per page the backend sends by default. */
export const ROWS_PER_PAGE = 100;

/** Row counts are estimates from the server, so they always carry a `~`. */
export function approxRows(n: number | null): string {
  return n === null ? "" : `~${n.toLocaleString("en-US")}`;
}

/** "Rows 101–200", or "No rows" for an empty page. */
export function rangeLabel(offset: number, shown: number): string {
  if (shown === 0) return "No rows";
  return `Rows ${(offset + 1).toLocaleString("en-US")}–${(offset + shown).toLocaleString("en-US")}`;
}

/** Tables whose name contains `term`, ignoring case. A blank term keeps them all. */
export function filterTables(tables: TableInfo[], term: string): TableInfo[] {
  const t = term.trim().toLowerCase();
  return t === ""
    ? tables
    : tables.filter((x) => x.name.toLowerCase().includes(t));
}

/** Schemas to offer: the user's own, plus the built-in ones when asked for. */
export function visibleSchemas(
  schemas: SchemaInfo[],
  showSystem: boolean,
  current: string | null,
): SchemaInfo[] {
  // The open schema always stays in the list, even if it is a system one.
  return schemas.filter((s) => showSystem || !s.system || s.name === current);
}

/** Which schema to open first: the profile's own, else the first user schema, else the first. */
export function pickSchema(
  schemas: SchemaInfo[],
  preferred: string | null,
): string | null {
  if (preferred && schemas.some((s) => s.name === preferred)) return preferred;
  return (schemas.find((s) => !s.system) ?? schemas[0])?.name ?? null;
}

const NUMERIC = new Set([
  "TINYINT",
  "SMALLINT",
  "MEDIUMINT",
  "INT",
  "INTEGER",
  "BIGINT",
  "DECIMAL",
  "NUMERIC",
  "FLOAT",
  "DOUBLE",
  "YEAR",
  // PostgreSQL's names for the same things.
  "INT2",
  "INT4",
  "INT8",
  "FLOAT4",
  "FLOAT8",
  "MONEY",
  "OID",
]);

/** Numbers line up on the right, like in a spreadsheet. */
export const isNumericType = (typeName: string) =>
  NUMERIC.has(typeName.toUpperCase().replace(/ UNSIGNED$/, ""));

/** The small line under a column name in the grid, such as `bigint · PK` or `varchar · null`. */
export function columnSub(
  col: ResultColumn,
  info: ColumnInfo | undefined,
): string {
  const parts = [(info?.dataType ?? col.typeName).toLowerCase()];
  if (info?.key === "PRI") parts.push("PK");
  if (info?.nullable) parts.push("null");
  return parts.join(" · ");
}

/** Results as tab-separated text, ready to paste into a spreadsheet. NULL is left empty. */
export function resultToTsv(
  columns: ResultColumn[],
  rows: (string | null)[][],
): string {
  // Tabs and line breaks inside a value would break the shape of the table.
  const clean = (v: string | null) =>
    v === null ? "" : v.replace(/[\t\r\n]+/g, " ");
  return [columns.map((c) => clean(c.name)), ...rows.map((r) => r.map(clean))]
    .map((r) => r.join("\t"))
    .join("\n");
}

/**
 * A short form of the estimate for tight places: 978, 1.2k, 48k, 401k, 7.7m.
 * Rounded, not cut off, and still marked with `~` because it is an estimate.
 */
export function approxCompact(n: number | null): string {
  if (n === null) return "";
  if (n < 1000) return `~${n}`;
  const units = ["k", "m", "b"];
  // Rounding can carry into the next unit (999,500 is "1m", not "1000k").
  for (let unit = 0; unit < units.length; unit++) {
    const value = n / 1000 ** (unit + 1);
    const rounded =
      value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
    if (rounded < 1000 || unit === units.length - 1)
      return `~${rounded}${units[unit]}`;
  }
  return `~${n}`;
}

/** "5 rows", "1 row" or "No rows". */
export function rowCountLabel(n: number): string {
  if (n === 0) return "No rows";
  return `${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"}`;
}

/** "12 ms", or seconds from a second up. */
export function elapsedLabel(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** How many numbered lines the editor shows for this text. Always at least one. */
export function lineCount(text: string): number {
  return text.split("\n").length;
}

/** What a click on a column heading does: sort up, then down, then back to the table's order. */
export function nextSort(
  current: { column: string; desc: boolean } | null,
  column: string,
): { column: string; desc: boolean } | null {
  if (current?.column !== column) return { column, desc: false };
  return current.desc ? null : { column, desc: true };
}

/** "3 items" or "2 keys" for a JSON array or object; null when the text is neither. */
export function jsonSummary(text: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (Array.isArray(value)) return plural(value.length, "item");
  if (value !== null && typeof value === "object")
    return plural(Object.keys(value).length, "key");
  return null;
}

/** JSON laid out over several lines, or null when the text isn't JSON. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/** True for a text column: TEXT in its sizes, VARCHAR and CHAR. */
export function isTextType(typeName: string): boolean {
  return /TEXT|CHAR/i.test(typeName);
}

/** The longest text column value that is checked for JSON; bigger ones stay plain text. */
export const TEXT_JSON_LIMIT = 200_000;

/** A value that is shown as JSON in the row views, and where it came from. */
export interface JsonField {
  /** Index of the column in the row. */
  index: number;
  /** The value laid out over several lines. */
  pretty: string;
  /** The value exactly as the server sent it. */
  raw: string;
  /** A JSON column, a text column that happens to hold JSON, or a PostgreSQL array. */
  source: "json" | "text" | "array";
}

/**
 * The JSON to show for one value. A JSON column always counts. A text column counts only
 * when the whole value is a JSON object or array, so "12" or a quoted word stays plain.
 */
export function jsonOf(
  typeName: string,
  value: string | null,
): { pretty: string; raw: string; source: JsonField["source"] } | null {
  if (value === null) return null;
  if (isJsonType(typeName)) {
    const pretty = prettyJson(value);
    return pretty ? { pretty, raw: value, source: "json" } : null;
  }
  if (isArrayType(typeName)) {
    const pretty = arrayJson(typeName, value);
    return pretty ? { pretty, raw: value, source: "array" } : null;
  }
  if (!isTextType(typeName) || value.length > TEXT_JSON_LIMIT) return null;
  const t = value.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  const pretty = prettyJson(t);
  return pretty ? { pretty, raw: value, source: "text" } : null;
}

/** What a row is called in the row views: "orders · id 48213", or just the table without an id. */
export function rowTitle(
  table: string,
  columns: { name: string }[],
  row: (string | null)[],
): string {
  const id = columns.findIndex((c) => c.name === "id");
  return id >= 0 && row[id] !== null ? `${table} · id ${row[id]}` : table;
}

/** Splits a row into the columns shown as a list and the ones shown as JSON. */
export function splitRow(
  columns: { name: string; typeName: string }[],
  row: (string | null)[],
): { plain: number[]; json: JsonField[] } {
  const plain: number[] = [];
  const json: JsonField[] = [];
  columns.forEach((c, index) => {
    const found = jsonOf(c.typeName, row[index]);
    if (found) json.push({ index, ...found });
    else plain.push(index);
  });
  return { plain, json };
}

/** A date and a time apart, so the date reads first: "2026-11-11 08:51:20" gives both halves. */
export function splitTimestamp(text: string): [string, string] | null {
  // PostgreSQL's timestamptz ends with an offset such as `+00` or `+05:30`.
  const m =
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}(?::?\d{2})?|Z)?)$/.exec(
      text,
    );
  return m ? [m[1], m[2]] : null;
}

/** PostgreSQL names an array type after its element: `TEXT[]`, `INT4[]`. */
export const isArrayType = (typeName: string) => typeName.endsWith("[]");

/** A parsed PostgreSQL array. Elements are text, null, or a nested array. */
export type PgArray = (string | null | PgArray)[];

/**
 * Reads PostgreSQL's array text, such as `{a,"b c",NULL,{1,2}}`. Null when the text is not
 * an array or is cut off, so a caller can fall back to showing it as it is.
 */
export function parsePgArray(text: string): PgArray | null {
  // A value can start with its bounds: `[0:2]={a,b,c}`.
  const s = text.trim().replace(/^\[[^\]]*\]=/, "");
  let i = 0;
  const list = (): PgArray | null => {
    if (s[i] !== "{") return null;
    i++;
    const out: PgArray = [];
    if (s[i] === "}") {
      i++;
      return out;
    }
    for (;;) {
      let item: string | null | PgArray;
      if (s[i] === "{") {
        const inner = list();
        if (inner === null) return null;
        item = inner;
      } else if (s[i] === '"') {
        i++;
        let v = "";
        let closed = false;
        while (i < s.length) {
          if (s[i] === "\\") {
            v += s[i + 1] ?? "";
            i += 2;
          } else if (s[i] === '"') {
            i++;
            closed = true;
            break;
          } else v += s[i++];
        }
        if (!closed) return null;
        item = v;
      } else {
        let j = i;
        while (j < s.length && s[j] !== "," && s[j] !== "}") j++;
        const word = s.slice(i, j).trim();
        if (word === "") return null;
        // Only a bare NULL is null. A quoted "NULL" is the word.
        item = word.toUpperCase() === "NULL" ? null : word;
        i = j;
      }
      out.push(item);
      if (s[i] === ",") {
        i++;
        continue;
      }
      if (s[i] === "}") {
        i++;
        return out;
      }
      return null;
    }
  };
  const parsed = list();
  return parsed !== null && i === s.length ? parsed : null;
}

/** A PostgreSQL array as JSON over several lines, with numbers and booleans as such. */
export function arrayJson(typeName: string, text: string): string | null {
  const parsed = parsePgArray(text);
  if (parsed === null) return null;
  const base = typeName.slice(0, -2).toUpperCase();
  const numeric = isNumericType(base);
  const conv = (v: string | null | PgArray): unknown => {
    if (Array.isArray(v)) return v.map(conv);
    if (v === null) return null;
    if (base === "BOOL") return v === "t" ? true : v === "f" ? false : v;
    // Only a number that survives the trip to JSON unchanged is turned into one.
    if (numeric && /^-?\d+(\.\d+)?$/.test(v) && String(Number(v)) === v)
      return Number(v);
    return v;
  };
  return JSON.stringify(parsed.map(conv), null, 2);
}

/**
 * True when a JSON text holds a number that JSON.parse cannot keep exactly (a 19-digit id,
 * say), so the formatted view would show a different one.
 */
export function hasInexactNumber(text: string): boolean {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < text.length && /[0-9.eE+-]/.test(text[j])) j++;
      const token = text.slice(i, j);
      if (
        /^-?\d+$/.test(token) &&
        String(Number(token)) !== token.replace(/^-0+(?=\d)/, "-")
      )
        return true;
      i = j - 1;
    }
  }
  return false;
}

/**
 * The same moment in UTC, for a `timestamptz` value that carries another offset, such as
 * `2026-11-11 09:42:07+07`. Null for a time already in UTC or one without an offset.
 */
export function utcOf(text: string): string | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?([+-])(\d{2})(?::?(\d{2}))?$/.exec(
      text,
    );
  if (!m) return null;
  const sign = m[8] === "-" ? -1 : 1;
  const offset = sign * (Number(m[9]) * 60 + Number(m[10] ?? 0));
  if (offset === 0) return null;
  const at = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
  const d = new Date(at - offset * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${m[7] ?? ""} UTC`;
}

/** True for a JSON column, however the server spells the type (`JSON`, or PostgreSQL's `JSONB`). */
export function isJsonType(typeName: string): boolean {
  const t = typeName.toUpperCase();
  return t === "JSON" || t === "JSONB";
}

/** True for DATETIME, TIMESTAMP, TIMESTAMPTZ and the like. */
export function isTimeType(typeName: string): boolean {
  return /^(DATETIME|TIMESTAMP)/i.test(typeName);
}

/** The most columns that can be pinned, so there is always room left to scroll. */
export const MAX_PINS = 3;

/** Pinned names that are columns of this result, in the order they were pinned. */
export function livePins(names: string[], pinned: string[]): string[] {
  return pinned.filter((p) => names.includes(p));
}

/** Column positions with the pinned ones first, in pin order, then the rest as they were. */
export function pinOrder(names: string[], pinned: string[]): number[] {
  const first = livePins(names, pinned).map((p) => names.indexOf(p));
  const rest = names.map((_, i) => i).filter((i) => !first.includes(i));
  return [...first, ...rest];
}

/** Pin or unpin a column. Pinning past the limit changes nothing. */
export function toggleColumnPin(
  pinned: string[],
  name: string,
  max = MAX_PINS,
): string[] {
  if (pinned.includes(name)) return pinned.filter((p) => p !== name);
  return pinned.length >= max ? pinned : [...pinned, name];
}
