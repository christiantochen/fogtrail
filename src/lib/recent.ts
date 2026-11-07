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
