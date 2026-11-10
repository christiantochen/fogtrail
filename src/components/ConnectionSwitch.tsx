import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connect } from "../api/browse";
import { useProfiles } from "../api/queries";
import { useUi } from "../state/ui";
import { dropBrowsingCaches } from "../lib/refreshAll";

/** One-step switch between saved connections. Switching closes the open one. */
export function ConnectionSwitch() {
  const qc = useQueryClient();
  const profiles = useProfiles();
  const connectedId = useUi((s) => s.connectedId);
  const setConnected = useUi((s) => s.setConnected);

  const change = useMutation({
    mutationFn: async (id: string) => {
      dropBrowsingCaches(qc);
      setConnected(await connect(id), id);
    },
  });

  const list = profiles.data ?? [];
  return (
    <div className="connswitch">
      <select
        aria-label="Switch connection"
        value={connectedId ?? ""}
        disabled={change.isPending}
        onChange={(e) => change.mutate(e.target.value)}
      >
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {change.isPending && <span className="muted">Switching…</span>}
      {change.error && (
        <span role="alert" className="field__error">
          {change.error.message}
        </span>
      )}
    </div>
  );
}
