import type { ColumnInfo, ResultColumn } from "../api/types";
import {
  hasInexactNumber,
  isArrayType,
  isJsonType,
  isNumericType,
  isTextType,
  type JsonField,
} from "./sql";

/** More columns than this and the row dialog adds its groups rail and kind filter. */
export const WIDE_AT = 24;

export const isWide = (columns: number) => columns > WIDE_AT;

export type Kind = "text" | "number" | "date" | "json" | "array" | "other";
export type KindFilter = "all" | Exclude<Kind, "other">;

export const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "text", label: "Text" },
  { id: "number", label: "Numbers" },
  { id: "date", label: "Dates" },
  { id: "json", label: "JSON" },
  { id: "array", label: "Arrays" },
];

/** What a column holds, for the kind filter. A text column holding JSON counts as JSON. */
export function kindOf(typeName: string, holdsJson = false): Kind {
  if (isArrayType(typeName)) return "array";
  if (isJsonType(typeName) || holdsJson) return "json";
  if (isNumericType(typeName)) return "number";
  if (/^(DATE|TIME|DATETIME|TIMESTAMP|YEAR)/i.test(typeName)) return "date";
  if (isTextType(typeName)) return "text";
  return "other";
}

export interface ColumnGroup {
  name: string;
  /** Positions of the columns, in table order. */
  columns: number[];
}

/**
 * Columns grouped by the name before the first underscore, when at least two share it.
 * Names without an underscore go under "core", a lone prefix under "other".
 */
export function groupColumns(names: string[]): ColumnGroup[] {
  const prefixOf = (n: string) => {
    const at = n.indexOf("_");
    return at > 0 ? n.slice(0, at + 1) : null;
  };
  const counts = new Map<string, number>();
  for (const n of names) {
    const p = prefixOf(n);
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const core: number[] = [];
  const other: number[] = [];
  const named = new Map<string, number[]>();
  names.forEach((n, i) => {
    const p = prefixOf(n);
    if (p === null) core.push(i);
    else if ((counts.get(p) ?? 0) >= 2)
      named.set(p, [...(named.get(p) ?? []), i]);
    else other.push(i);
  });
  return [
    ...(core.length > 0 ? [{ name: "core", columns: core }] : []),
    ...[...named].map(([name, columns]) => ({ name, columns })),
    ...(other.length > 0 ? [{ name: "other", columns: other }] : []),
  ];
}

/** The small badge next to a column name: its type, and PK for a primary key. */
export function typeBadge(
  col: ResultColumn,
  info: ColumnInfo | undefined,
): string {
  const type = (info?.dataType ?? col.typeName).toLowerCase();
  return info?.key === "PRI" ? `${type} · PK` : type;
}

/**
 * A row as a JSON object, for "Copy row as JSON". JSON columns and arrays become real JSON,
 * unless a number in them is too big to survive, which stays as the server's text.
 */
export function rowObject(
  columns: { name: string }[],
  row: (string | null)[],
  json: JsonField[],
): Record<string, unknown> {
  const at = new Map(json.map((f) => [f.index, f]));
  const out: Record<string, unknown> = {};
  columns.forEach((c, i) => {
    const value = row[i];
    const f = at.get(i);
    if (value === null || !f || f.source === "text") {
      out[c.name] = value;
      return;
    }
    const text = f.source === "array" ? f.pretty : f.raw;
    if (hasInexactNumber(text)) {
      out[c.name] = value;
      return;
    }
    try {
      out[c.name] = JSON.parse(text);
    } catch {
      out[c.name] = value;
    }
  });
  return out;
}
