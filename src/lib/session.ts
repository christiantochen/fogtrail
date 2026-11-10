const KEY = "fogtrail.session";

/** Where the user was, so the next launch can pick up from there. */
export interface Session {
  profileId: string;
  database: number;
  expanded: string[];
  selected: string | null;
  filter: string;
  /** SQL connections: the open schema and table. */
  schema: string | null;
  table: string | null;
}

/** Reads a saved session, or null when there is none or it is unusable. */
export function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Session>;
    if (typeof v.profileId !== "string" || v.profileId === "") return null;
    return {
      profileId: v.profileId,
      database: Number.isInteger(v.database) ? (v.database as number) : 0,
      expanded: Array.isArray(v.expanded)
        ? v.expanded.filter((p) => typeof p === "string")
        : [],
      selected: typeof v.selected === "string" ? v.selected : null,
      filter: typeof v.filter === "string" ? v.filter : "",
      schema: typeof v.schema === "string" ? v.schema : null,
      table: typeof v.table === "string" ? v.table : null,
    };
  } catch {
    return null;
  }
}

export function loadSession(): Session | null {
  try {
    return parseSession(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Not remembering is fine; the app still works.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
