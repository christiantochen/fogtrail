import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connect } from "../api/browse";
import { useProfiles } from "../api/queries";
import { useUi } from "../state/ui";
import { Dropdown } from "./Dropdown";
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
      <Dropdown
        label="Switch connection"
        value={connectedId ?? ""}
        disabled={change.isPending}
        onChange={(id) => change.mutate(id)}
        options={list.map((p) => ({
          value: p.id,
          label: p.name,
          meta: p.driver === "mysql" ? "MySQL" : "Redis",
        }))}
      />
      {change.isPending && <span className="muted">Switching…</span>}
      {change.error && (
        <span role="alert" className="field__error">
          {change.error.message}
        </span>
      )}
    </div>
  );
}
