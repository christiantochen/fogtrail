import { useMutation, useQueryClient } from "@tanstack/react-query";
import { selectDatabase } from "../api/browse";
import { useServerInfo } from "../api/queries";
import { databaseChoices } from "../lib/format";
import { useUi } from "../state/ui";

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
  const choices = databaseChoices([...counts.keys()], conn.database);

  return (
    <label className="dbselect">
      <span className="dbselect__label">Database</span>
      <select
        value={conn.database}
        disabled={change.isPending}
        onChange={(e) => change.mutate(Number(e.target.value))}
      >
        {choices.map((n) => (
          <option key={n} value={n}>
            db{n}
            {counts.has(n) ? ` · ${counts.get(n)} keys` : ""}
          </option>
        ))}
      </select>
      {change.error && (
        <span role="alert" className="field__error">
          {change.error.message}
        </span>
      )}
    </label>
  );
}
