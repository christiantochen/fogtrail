import { clearSession, saveSession } from "../lib/session";
import { useUi } from "./ui";

/** Keeps the saved session in step with what the user is doing. Returns a stop function. */
export function persistSession(): () => void {
  return useUi.subscribe((s, prev) => {
    // While reconnecting at launch, the saved session is what's being restored.
    if (s.resuming) return;
    if (s.connected && s.connectedId) {
      saveSession({
        profileId: s.connectedId,
        database: s.connected.database,
        expanded: [...s.expanded],
        selected: s.selected,
        filter: s.filter,
        schema: s.sqlSchema,
        table: s.sqlTable,
      });
    } else if (prev.connected && !s.connected) {
      // Disconnecting on purpose means "don't pick this up again".
      clearSession();
    }
  });
}
