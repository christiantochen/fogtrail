import type { QueryClient } from "@tanstack/react-query";

/** Rescans the keys and re-reads the open key and the server info. */
export function refreshAll(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["keys"] });
  void qc.invalidateQueries({ queryKey: ["key"] });
  void qc.invalidateQueries({ queryKey: ["serverInfo"] });
}
