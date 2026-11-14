import { useProfiles } from "../api/queries";
import { useUi } from "../state/ui";
import { Mark } from "./Icons";
import { driverLabel } from "../lib/profile";

export function ConnectionsSidebar() {
  const profiles = useProfiles();
  const editing = useUi((s) => s.editing);
  const edit = useUi((s) => s.edit);
  const connected = useUi((s) => s.connected);
  const connectedId = useUi((s) => s.connectedId);
  const resume = useUi((s) => s.resume);

  return (
    <aside className="sidebar">
      <div className="brand">
        <Mark />
        <span>Fogtrail</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="icon-btn"
          aria-label="New connection"
          onClick={() => edit("new")}
        >
          +
        </button>
      </div>

      <div className="section-label">Connections</div>

      <nav aria-label="Saved connections" className="tree">
        {profiles.isPending && <div className="skeleton" aria-busy="true" />}
        {profiles.isError && (
          <div role="alert" className="alert">
            {profiles.error.message}
          </div>
        )}
        {profiles.data?.length === 0 && (
          <p className="note">Nothing saved yet.</p>
        )}
        {profiles.data?.map((p) => (
          <button
            key={p.id}
            type="button"
            className="row row--conn"
            aria-current={editing === p.id}
            onClick={() =>
              p.id === connectedId && connected ? resume() : edit(p.id)
            }
          >
            <span className={`dot${p.id === connectedId ? " dot--on" : ""}`} />
            <span className="card__text">
              <span className="card__title">{p.name}</span>
              <span className="card__sub mono">
                {p.id === connectedId ? "Connected · " : ""}
                {p.host}:{p.port}
                {p.tls ? " · TLS" : ""}
              </span>
            </span>
            {p.driver !== "redis" && (
              <span className="badge">{driverLabel(p.driver)}</span>
            )}
          </button>
        ))}
      </nav>
    </aside>
  );
}
