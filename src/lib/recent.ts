const MAX = 10;
const keyFor = (profileId: string) => `fogtrail.recent.${profileId}`;

/** Puts `name` first, drops repeats, keeps the newest `max`. */
export function pushRecent(
  list: readonly string[],
  name: string,
  max = MAX,
): string[] {
  return [name, ...list.filter((n) => n !== name)].slice(0, max);
}

export function loadRecent(profileId: string): string[] {
  try {
    const v: unknown = JSON.parse(
      localStorage.getItem(keyFor(profileId)) ?? "[]",
    );
    return Array.isArray(v)
      ? v.filter((n): n is string => typeof n === "string").slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function saveRecent(profileId: string, list: readonly string[]): void {
  try {
    localStorage.setItem(keyFor(profileId), JSON.stringify(list));
  } catch {
    // Not remembering is fine.
  }
}

/** Tables opened on one connection, newest first, as schema and table. */
export interface RecentTable {
  schema: string;
  table: string;
}

const tablesKey = (profileId: string) => `fogtrail.recentTables.${profileId}`;

/** Puts `ref` first, drops repeats, keeps the newest `max`. */
export function pushRecentTable(
  list: readonly RecentTable[],
  ref: RecentTable,
  max = MAX,
): RecentTable[] {
  return [
    ref,
    ...list.filter((r) => r.schema !== ref.schema || r.table !== ref.table),
  ].slice(0, max);
}

export function loadRecentTables(profileId: string): RecentTable[] {
  try {
    const v: unknown = JSON.parse(
      localStorage.getItem(tablesKey(profileId)) ?? "[]",
    );
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (r): r is RecentTable =>
          typeof r === "object" &&
          r !== null &&
          typeof (r as RecentTable).schema === "string" &&
          typeof (r as RecentTable).table === "string",
      )
      .map((r) => ({ schema: r.schema, table: r.table }))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function saveRecentTables(
  profileId: string,
  list: readonly RecentTable[],
): void {
  try {
    localStorage.setItem(tablesKey(profileId), JSON.stringify(list));
  } catch {
    // Not remembering is fine.
  }
}
