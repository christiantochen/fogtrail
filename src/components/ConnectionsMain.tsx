import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connect, disconnect } from "../api/browse";
import { useProfiles } from "../api/queries";
import { useUi } from "../state/ui";
import { ConnectionForm } from "./ConnectionForm";
import { dropBrowsingCaches } from "../lib/refreshAll";

export function ConnectionsMain() {
  const profiles = useProfiles();
  const editing = useUi((s) => s.editing);
  const edit = useUi((s) => s.edit);
  const setConnected = useUi((s) => s.setConnected);
  const connected = useUi((s) => s.connected);
  const connectedId = useUi((s) => s.connectedId);
  const resume = useUi((s) => s.resume);
  const launchError = useUi((s) => s.launchError);
  const qc = useQueryClient();
  const open = useMutation({
    mutationFn: async (id: string) => {
      dropBrowsingCaches(qc);
      setConnected(await connect(id), id);
    },
  });
  // Ending the session is a deliberate act, never a side effect of navigating.
  const close = useMutation({
    mutationFn: async () => {
      await disconnect();
      dropBrowsingCaches(qc);
      setConnected(null);
    },
  });

  const hasProfiles = (profiles.data?.length ?? 0) > 0;
  useEffect(() => {
    if (!hasProfiles) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editing) edit(null);
      else if (connected) resume();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, hasProfiles, connected, edit, resume]);

  if (!profiles.data) return <main className="main" />;
  const list = profiles.data;
  const liveName = list.find((p) => p.id === connectedId)?.name;
  const current = list.find((p) => p.id === editing) ?? null;
  const first = list.length === 0;

  return (
    <main className="main">
      <header className="trail">
        {connected && (
          <>
            <button type="button" className="crumb" onClick={resume}>
              {liveName ?? "Connection"}
            </button>
            <span aria-hidden="true">›</span>
          </>
        )}
        {editing ? (
          <button type="button" className="crumb" onClick={() => edit(null)}>
            Connections
          </button>
        ) : (
          <span className="crumb crumb--here">Connections</span>
        )}
        {current && <span className="crumb crumb--here">{current.name}</span>}
        {editing === "new" && <span className="crumb crumb--here">New</span>}
      </header>
      <div className="detail">
        {first || editing ? (
          <ConnectionForm
            key={editing ?? "first"}
            profile={current}
            first={first}
          />
        ) : (
          <div className="state">
            <h2>Pick a connection</h2>
            <p>
              {connected
                ? `You are connected to ${liveName ?? "a server"}. Connecting to another closes it.`
                : "Choose one to connect, or edit its settings."}
            </p>
            <div className="picker">
              {list.map((p) => {
                const live = connected !== null && p.id === connectedId;
                return (
                  <div className="card" key={p.id}>
                    {live && <span className="dot dot--on" />}
                    <div className="card__text">
                      <span className="card__title">{p.name}</span>
                      <span className="card__sub mono">
                        {p.host}:{p.port}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => edit(p.id)}
                    >
                      Edit
                    </button>
                    {live ? (
                      <>
                        <button
                          type="button"
                          className="btn"
                          disabled={close.isPending}
                          onClick={() => close.mutate()}
                        >
                          Disconnect
                        </button>
                        <button
                          type="button"
                          className="btn btn--primary"
                          onClick={resume}
                        >
                          Open
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--primary"
                        disabled={open.isPending}
                        onClick={() => open.mutate(p.id)}
                      >
                        {connected ? "Switch" : "Connect"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {launchError && !open.error && (
              <div role="alert" className="alert alert--block">
                {launchError}
              </div>
            )}
            {(open.error ?? close.error) && (
              <div role="alert" className="alert alert--block">
                {(open.error ?? close.error)?.message}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
