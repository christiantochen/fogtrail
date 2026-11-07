/** Auto-refresh intervals in seconds; 0 is off. */
export const REFRESH_OPTIONS = [0, 2, 5, 10, 30] as const;
const KEY = "fogtrail.refresh";

export function loadRefresh(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return (REFRESH_OPTIONS as readonly number[]).includes(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveRefresh(seconds: number): void {
  try {
    localStorage.setItem(KEY, String(seconds));
  } catch {
    // Not remembering is fine.
  }
}

/** "just now", "2s ago", "3m ago". */
export function formatAgo(seconds: number): string {
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/** The entries of `next` that `prev` did not have: what changed between two reads. */
export function freshEntries(
  prev: readonly string[],
  next: readonly string[],
): Set<string> {
  const had = new Set(prev);
  return new Set(next.filter((e) => !had.has(e)));
}
