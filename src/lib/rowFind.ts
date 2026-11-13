import { findRanges, MAX_HITS, type Range } from "./find";
import type { JsonField } from "./sql";

/** What a search finds in one column of a row. */
export interface FieldHits {
  /** Index of the column in the row. */
  index: number;
  /** Matches in the column name. */
  name: Range[];
  /** Matches in a plain value. A null cell is one match covering the word "null". */
  value: Range[];
  /** How many matches there are inside the column's JSON value (0 for a plain column). */
  json: number;
}

/** Where a search term matches in a row, one entry per column that has a match, in column order. */
export interface RowHits {
  fields: FieldHits[];
  /** The matches to step through, capped at MAX_HITS. A JSON column counts once, however many matches it holds. */
  total: number;
}

/** The only search term that matches a null cell: the whole word, in any case. */
export const NULL_WORD = "null";

export function findInRow(
  columns: { name: string }[],
  row: (string | null)[],
  json: readonly JsonField[],
  term: string,
): RowHits {
  const out: RowHits = { fields: [], total: 0 };
  if (term === "") return out;
  const asJson = new Map(json.map((f) => [f.index, f]));
  const isNullWord = term.toLowerCase() === NULL_WORD;
  for (let index = 0; index < columns.length; index++) {
    const room = MAX_HITS - out.total;
    if (room <= 0) break;
    const name = findRanges(columns[index].name, term).slice(0, room);
    let value: Range[] = [];
    let inJson = 0;
    const field = asJson.get(index);
    if (field) {
      inJson = findRanges(field.pretty, term).length;
    } else if (row[index] === null) {
      if (isNullWord) value = [[0, NULL_WORD.length]];
    } else {
      value = findRanges(row[index] as string, term);
    }
    value = value.slice(0, room - name.length);
    const counts = name.length + value.length + (inJson > 0 ? 1 : 0);
    if (counts === 0) continue;
    out.fields.push({ index, name, value, json: inJson });
    out.total += Math.min(counts, room);
  }
  return out;
}

/** Match number `n` (0-based, in reading order) as a place: which column and which part of it. */
export type HitPlace = {
  kind: "name" | "value" | "json";
  index: number;
  /** Which match inside that part. A JSON column is always 0. */
  local: number;
};

export function placeOf(hits: RowHits, n: number): HitPlace | null {
  if (n < 0 || n >= hits.total) return null;
  let left = n;
  for (const f of hits.fields) {
    if (left < f.name.length)
      return { kind: "name", index: f.index, local: left };
    left -= f.name.length;
    if (left < f.value.length)
      return { kind: "value", index: f.index, local: left };
    left -= f.value.length;
    if (f.json > 0) {
      if (left === 0) return { kind: "json", index: f.index, local: 0 };
      left -= 1;
    }
  }
  return null;
}

/** "3 of 7", "No matches", or "2000+ matches" once the cap is reached. */
export function hitsLabel(total: number, current: number): string {
  if (total === 0) return "No matches";
  if (total >= MAX_HITS) return `${MAX_HITS}+ matches`;
  return `${current + 1} of ${total}`;
}
