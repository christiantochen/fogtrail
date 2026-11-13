import { findRanges, MAX_HITS, type Range } from "./find";
import type { JsonField } from "./sql";

/** Where a search term matches in a row's plain columns and JSON values, in reading order. */
export interface RowHits {
  /** Plain columns with at least one match, in column order. */
  fields: { index: number; name: Range[]; value: Range[] }[];
  /** JSON values with at least one match. */
  json: { index: number; ranges: Range[] }[];
  /** All matches, capped at MAX_HITS. */
  total: number;
}

/** What a NULL value is searched as, so typing "null" finds the NULL cells. */
export const NULL_TEXT = "NULL";

export function findInRow(
  columns: { name: string }[],
  row: (string | null)[],
  plain: readonly number[],
  json: readonly JsonField[],
  term: string,
): RowHits {
  const out: RowHits = { fields: [], json: [], total: 0 };
  if (term === "") return out;
  const room = () => MAX_HITS - out.total;
  for (const index of plain) {
    if (room() <= 0) break;
    const name = findRanges(columns[index].name, term).slice(0, room());
    const value = findRanges(row[index] ?? NULL_TEXT, term).slice(
      0,
      room() - name.length,
    );
    if (name.length + value.length === 0) continue;
    out.fields.push({ index, name, value });
    out.total += name.length + value.length;
  }
  for (const f of json) {
    if (room() <= 0) break;
    const ranges = findRanges(f.pretty, term).slice(0, room());
    if (ranges.length === 0) continue;
    out.json.push({ index: f.index, ranges });
    out.total += ranges.length;
  }
  return out;
}

/** The match number `n` (0-based, in reading order) as a place: which column, which part, which one in it. */
export type HitPlace =
  | { kind: "name" | "value"; index: number; local: number }
  | { kind: "json"; index: number; local: number };

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
  }
  for (const j of hits.json) {
    if (left < j.ranges.length)
      return { kind: "json", index: j.index, local: left };
    left -= j.ranges.length;
  }
  return null;
}

/** "3 of 7", "No matches", or "2000+ matches" once the cap is reached. */
export function hitsLabel(total: number, current: number): string {
  if (total === 0) return "No matches";
  if (total >= MAX_HITS) return `${MAX_HITS}+ matches`;
  return `${current + 1} of ${total}`;
}
