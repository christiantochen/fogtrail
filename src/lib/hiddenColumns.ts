/**
 * Columns the person has hidden in a table, kept per connection, schema and table in local
 * storage. Names only: nothing about the rows. A name that no longer exists is ignored.
 */
const keyFor = (profileId: string, schema: string, table: string) =>
  `fogtrail.hidden.${JSON.stringify([profileId, schema, table])}`;

export function loadHidden(
  profileId: string,
  schema: string,
  table: string,
): string[] {
  try {
    const raw = localStorage.getItem(keyFor(profileId, schema, table));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? [...new Set(list.filter((n): n is string => typeof n === "string"))]
      : [];
  } catch {
    return [];
  }
}

export function saveHidden(
  profileId: string,
  schema: string,
  table: string,
  hidden: readonly string[],
): void {
  try {
    const key = keyFor(profileId, schema, table);
    if (hidden.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(hidden));
  } catch {
    // Not remembering is fine.
  }
}

/**
 * The hidden names that are still columns of the table. If that would hide every column (a
 * table that lost the rest, or a damaged value), nothing is hidden: the grid is never empty.
 */
export function liveHidden(
  hidden: readonly string[],
  names: readonly string[],
): string[] {
  const live = hidden.filter((h) => names.includes(h));
  return live.length >= names.length ? [] : live;
}

/**
 * Whether a column may be hidden: not a pinned one (unpin it first), and never the last one
 * showing, so the grid is never empty.
 */
export function canHide(
  names: readonly string[],
  hidden: readonly string[],
  pinned: readonly string[],
  name: string,
): boolean {
  if (hidden.includes(name)) return true;
  if (pinned.includes(name)) return false;
  return names.filter((n) => !hidden.includes(n)).length > 1;
}

export function toggleHidden(
  hidden: readonly string[],
  name: string,
): string[] {
  return hidden.includes(name)
    ? hidden.filter((h) => h !== name)
    : [...hidden, name];
}

/** The indexes of the columns that show, in table order. */
export function shownIndexes(
  names: readonly string[],
  hidden: readonly string[],
): number[] {
  return names.flatMap((n, i) => (hidden.includes(n) ? [] : [i]));
}

/** Columns whose name contains `term`, ignoring case. A blank term keeps them all. */
export function matchColumns<T extends { name: string }>(
  columns: readonly T[],
  term: string,
): T[] {
  const t = term.trim().toLowerCase();
  return t === ""
    ? [...columns]
    : columns.filter((c) => c.name.toLowerCase().includes(t));
}
