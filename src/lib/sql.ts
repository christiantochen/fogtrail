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
  /** A JSON column, or a text column that happens to hold a JSON object or array. */
  source: "json" | "text";
}

/**
 * The JSON to show for one value. A JSON column always counts. A text column counts only
 * when the whole value is a JSON object or array, so "12" or a quoted word stays plain.
 */
export function jsonOf(
  typeName: string,
  value: string | null,
): { pretty: string; source: JsonField["source"] } | null {
  if (value === null) return null;
  if (isJsonType(typeName)) {
    const pretty = prettyJson(value);
    return pretty ? { pretty, source: "json" } : null;
  }
  if (!isTextType(typeName) || value.length > TEXT_JSON_LIMIT) return null;
  const t = value.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return null;
  const pretty = prettyJson(t);
  return pretty ? { pretty, source: "text" } : null;
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
