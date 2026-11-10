import type { QueryClient } from "@tanstack/react-query";
import { SQL_KEYS } from "../api/queries";

/** Everything a connection has cached. Call when switching to another connection. */
export function dropBrowsingCaches(qc: QueryClient): void {
  for (const key of ["keys", "key", ...SQL_KEYS]) {
    qc.removeQueries({ queryKey: [key] });
  }
}

/** Rescans the keys and re-reads the open key and the server info, or the schemas and tables. */
export function refreshAll(qc: QueryClient): void {
  for (const key of SQL_KEYS) void qc.invalidateQueries({ queryKey: [key] });
  void qc.invalidateQueries({ queryKey: ["keys"] });
  void qc.invalidateQueries({ queryKey: ["key"] });
  void qc.invalidateQueries({ queryKey: ["serverInfo"] });
}
