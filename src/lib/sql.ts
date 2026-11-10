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
