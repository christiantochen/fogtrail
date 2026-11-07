export type Range = [start: number, end: number];

/** Past this many hits, stop counting: the view stays quick and the number reads "2000+". */
export const MAX_HITS = 2000;

/** Case-insensitive, non-overlapping matches of `term` in `text`. */
export function findRanges(text: string, term: string): Range[] {
  const out: Range[] = [];
  if (term === "") return out;
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();
  // Lowercasing can change length for a few characters; fall back to no match then.
  if (hay.length !== text.length) return out;
  for (
    let at = hay.indexOf(needle);
    at !== -1 && out.length < MAX_HITS;
    at = hay.indexOf(needle, at + needle.length)
  ) {
    out.push([at, at + needle.length]);
  }
  return out;
}

export interface Piece {
  text: string;
  /** Index of the match this piece belongs to, or null for plain text. */
  hit: number | null;
}

/**
 * Cuts `text` (which starts at `offset` in the searched string) into plain and
 * matched pieces. A match that spans several pieces of the same string keeps one index.
 */
export function piecesOf(
  text: string,
  offset: number,
  ranges: readonly Range[],
): Piece[] {
  const end = offset + text.length;
  const out: Piece[] = [];
  let at = offset;
  ranges.forEach(([s, e], hit) => {
    if (e <= offset || s >= end) return;
    const from = Math.max(s, offset);
    const to = Math.min(e, end);
    if (from > at)
      out.push({ text: text.slice(at - offset, from - offset), hit: null });
    out.push({ text: text.slice(from - offset, to - offset), hit });
    at = to;
  });
  if (at < end) out.push({ text: text.slice(at - offset), hit: null });
  return out;
}

/** Next index in a ring of `count`, going back when `back`. */
export function stepHit(current: number, count: number, back = false): number {
  if (count === 0) return 0;
  return (current + (back ? count - 1 : 1)) % count;
}

/** Sent by the native menu to put the cursor in the value's find box. */
export const FIND_VALUE_EVENT = "fogtrail:find-value";
