/** Rows per page the data view can ask for. The first is the default. */
export const PAGE_SIZES = [100, 250, 500] as const;
export const DEFAULT_PAGE_SIZE: number = PAGE_SIZES[0];

const keyFor = (profileId: string) => `fogtrail.pageSize.${profileId}`;

/** A size we offer, or the default for anything else. */
export function validPageSize(n: unknown): number {
  return (PAGE_SIZES as readonly unknown[]).includes(n)
    ? (n as number)
    : DEFAULT_PAGE_SIZE;
}

export function loadPageSize(profileId: string): number {
  try {
    return validPageSize(Number(localStorage.getItem(keyFor(profileId))));
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

export function savePageSize(profileId: string, size: number): void {
  try {
    localStorage.setItem(keyFor(profileId), String(validPageSize(size)));
  } catch {
    // Not remembering is fine.
  }
}

/** "14:32:05" in the computer's own time, for "Updated 14:32:05". */
export function clockLabel(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}
