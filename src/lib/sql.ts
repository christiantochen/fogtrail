import type {
  ColumnInfo,
  ResultColumn,
  SchemaInfo,
  TableInfo,
} from "../api/types";

/** Rows per page the backend sends by default. */
export const ROWS_PER_PAGE = 100;

/** MySQL's row counts are estimates, so they always carry a `~`. */
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

/** A date and a time apart, so the date reads first: "2026-11-11 08:51:20" gives both halves. */
export function splitTimestamp(text: string): [string, string] | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(text);
  return m ? [m[1], m[2]] : null;
}

/** True for a JSON column, however the server spells the type. */
export function isJsonType(typeName: string): boolean {
  return typeName.toUpperCase() === "JSON";
}

/** True for DATETIME, TIMESTAMP and the like. */
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
