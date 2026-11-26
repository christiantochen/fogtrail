import type { ForeignKeyInfo } from "../api/types";
import { isNumericType, type SqlDialect } from "./sql";

/** A name in the dialect's quotes: backticks for MySQL, double quotes for PostgreSQL. */
export function quoteName(dialect: SqlDialect, name: string): string {
  const q = dialect === "postgres" ? '"' : "`";
  return `${q}${name.split(q).join(q + q)}${q}`;
}

const hex = (text: string) =>
  Array.from(new TextEncoder().encode(text), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

/**
 * A value as a SQL literal that means the same text in any session setting.
 * Whole numbers stay bare only when `numeric` says the key column is a number: against a text
 * column PostgreSQL refuses `"code" = 48`, and MySQL would match `'48abc'`. Text is quoted with its quotes doubled; MySQL text that holds a
 * backslash goes in as hex, because whether `\` escapes depends on the server's sql_mode.
 * PostgreSQL text that holds one goes in as an `E'…'` string with the backslashes doubled, for
 * the same reason (standard_conforming_strings).
 * A value with a NUL byte has no safe literal, so it gets none.
 */
export function sqlLiteral(
  dialect: SqlDialect,
  value: string,
  numeric = false,
): string | null {
  if (value.includes("\0")) return null;
  if (numeric && /^(0|-?[1-9]\d{0,17})$/.test(value)) return value;
  if (dialect === "mysql" && value.includes("\\")) {
    return `CONVERT(X'${hex(value)}' USING utf8mb4)`;
  }
  if (dialect === "postgres" && value.includes("\\")) {
    // An escape string means the same in either standard_conforming_strings setting, and the
    // guard reads it the same way the server does.
    return `E'${value.split("\\").join("\\\\").split("'").join("''")}'`;
  }
  return `'${value.split("'").join("''")}'`;
}

/** The foreign key a column belongs to (the first one, if it is in several). */
export function fkFor(
  foreignKeys: readonly ForeignKeyInfo[],
  column: string,
): ForeignKeyInfo | undefined {
  return foreignKeys.find((f) => f.columns.includes(column));
}

/**
 * The WHERE condition that finds the row a foreign key points at: every column of the key must
 * match. Null when any part of the key is missing from the row, null, or has no safe literal,
 * because then there is no row to go to.
 */
export function fkFilter(
  dialect: SqlDialect,
  fk: ForeignKeyInfo,
  columns: readonly { name: string; typeName: string }[],
  row: readonly (string | null)[],
): string | null {
  if (fk.columns.length === 0 || fk.columns.length !== fk.refColumns.length) {
    return null;
  }
  const parts: string[] = [];
  for (let k = 0; k < fk.columns.length; k++) {
    const at = columns.findIndex((c) => c.name === fk.columns[k]);
    const value = at < 0 ? null : row[at];
    if (value === null) return null;
    const literal = sqlLiteral(
      dialect,
      value,
      isNumericType(columns[at].typeName),
    );
    if (literal === null) return null;
    parts.push(`${quoteName(dialect, fk.refColumns[k])} = ${literal}`);
  }
  return parts.join(" AND ");
}

/** "customers.id" for a key in the open schema, "other.customers.id" for another one. */
export function fkLabel(fk: ForeignKeyInfo, schema: string): string {
  const table =
    fk.refSchema === schema ? fk.refTable : `${fk.refSchema}.${fk.refTable}`;
  return fk.refColumns.length === 1
    ? `${table}.${fk.refColumns[0]}`
    : `${table} (${fk.refColumns.join(", ")})`;
}
