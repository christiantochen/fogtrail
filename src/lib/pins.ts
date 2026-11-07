const keyFor = (profileId: string) => `fogtrail.pins.${profileId}`;

/** Pins `name` at the end, or unpins it when already pinned. */
export function togglePin(list: readonly string[], name: string): string[] {
  return list.includes(name) ? list.filter((n) => n !== name) : [...list, name];
}

export function loadPins(profileId: string): string[] {
  try {
    const v: unknown = JSON.parse(
      localStorage.getItem(keyFor(profileId)) ?? "[]",
    );
    return Array.isArray(v)
      ? v.filter((n): n is string => typeof n === "string")
      : [];
  } catch {
    return [];
  }
}

export function savePins(profileId: string, list: readonly string[]): void {
  try {
    localStorage.setItem(keyFor(profileId), JSON.stringify(list));
  } catch {
    // Not remembering is fine.
  }
}
