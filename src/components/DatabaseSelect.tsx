import { useMutation, useQueryClient } from "@tanstack/react-query";
import { selectDatabase } from "../api/browse";
import { useServerInfo } from "../api/queries";
import { databaseChoices } from "../lib/format";
import { useUi } from "../state/ui";
import { Dropdown } from "./Dropdown";

/**
 * A small database picker for the search row. It lists only databases that exist,
 * and is not drawn at all when the server has just one.
 */
export function DatabaseSelect() {
  const qc = useQueryClient();
  const conn = useUi((s) => s.connected);
  const setConnected = useUi((s) => s.setConnected);
  const info = useServerInfo();

  const change = useMutation({
    mutationFn: selectDatabase,
    onSuccess: async (next) => {
      setConnected(next);
      qc.removeQueries({ queryKey: ["key"] });
      await qc.invalidateQueries({ queryKey: ["serverInfo"] });
      await qc.resetQueries({ queryKey: ["keys"] });
    },
  });

  if (!conn) return null;
  const counts = new Map(info.data?.databases.map((d) => [d.index, d.keys]));
  const count = info.data?.databaseCount ?? null;
  const choices = databaseChoices([...counts.keys()], conn.database, count);
  // Before the server has answered, or with a single database, there is nothing to pick.
  if (!info.data || choices.length < 2) return null;

  return (
    <div className="dbpick">
      {/* The closed box shows just "db0"; the list keeps the key counts. */}
      <Dropdown
        label="Database"
        title={
          count === null
            ? "Database. This server doesn't report how many it has, so only ones with keys are listed."
            : "Database"
        }
        value={conn.database}
        disabled={change.isPending}
        onChange={(n) => change.mutate(n)}
        options={choices.map((n) => ({
          value: n,
          label: `db${n}${counts.has(n) ? ` · ${counts.get(n)} keys` : ""}`,
          shown: `db${n}`,
        }))}
      />
      {change.error && (
        <span role="alert" className="field__error dbpick__error">
          {change.error.message}
        </span>
      )}
    </div>
  );
}
