import { trailOf } from "../lib/tree";
import { useUi } from "../state/ui";
import { Chevron } from "./Icons";
import { KeyDetail } from "./KeyDetail";
import { ServerPanel } from "./ServerPanel";

export function Main() {
  const selected = useUi((s) => s.selected);
  const view = useUi((s) => s.view);
  const setFilter = useUi((s) => s.setFilter);
  const delimiter = useUi((s) => s.delimiter);

  const trail = selected && view === "keys" ? trailOf(selected, delimiter) : [];

  return (
    <main className="main">
      <header className="trail">
        <nav
          aria-label="Trail"
          style={{ display: "flex", alignItems: "center", gap: 4 }}
        >
          {view === "server" && (
            <span className="crumb crumb--here">Server</span>
          )}
          {view === "keys" && trail.length === 0 && <span>Keys</span>}
          {trail.map((c, i) => {
            const last = i === trail.length - 1;
            return (
              <span
                key={c.path}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                {last ? (
                  <span className="crumb crumb--here mono" aria-current="page">
                    {c.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="crumb mono"
                    title={`Search ${c.path}${delimiter}`}
                    onClick={() => setFilter(c.path + delimiter)}
                  >
                    {c.label}
                  </button>
                )}
                {!last && <Chevron />}
              </span>
            );
          })}
        </nav>
      </header>
      {view === "server" ? (
        <ServerPanel />
      ) : selected ? (
        <KeyDetail name={selected} />
      ) : (
        <div className="state">
          <h2>Pick a key to read it</h2>
          <p>Choose one from the list, or press / to search.</p>
        </div>
      )}
    </main>
  );
}
