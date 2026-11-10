import { useProfiles } from "../api/queries";
import { useUi } from "../state/ui";
import { Chevron } from "./Icons";
import { QueryEditor } from "./QueryEditor";
import { TableView } from "./TableView";

/** The main area for a SQL connection: the trail, then the open table. */
export function SqlMain() {
  const schema = useUi((s) => s.sqlSchema);
  const table = useUi((s) => s.sqlTable);
  const queryOpen = useUi((s) => s.sqlQueryOpen);
  const selectTable = useUi((s) => s.selectTable);
  const openConnections = useUi((s) => s.openConnections);
  const connectedId = useUi((s) => s.connectedId);
  const profiles = useProfiles();
  const name = profiles.data?.find((p) => p.id === connectedId)?.name;

  return (
    <main className="main">
      <header className="trail">
        <nav
          aria-label="Trail"
          style={{ display: "flex", alignItems: "center", gap: 4 }}
        >
          {name && (
            <button type="button" className="crumb" onClick={openConnections}>
              {name}
            </button>
          )}
          {schema && (
            <>
              {name && <Chevron />}
              {table || queryOpen ? (
                <button
                  type="button"
                  className="crumb"
                  onClick={() => selectTable(null)}
                >
                  {schema}
                </button>
              ) : (
                <span className="crumb crumb--here" aria-current="page">
                  {schema}
                </span>
              )}
            </>
          )}
          {schema && queryOpen && (
            <>
              <Chevron />
              <span className="crumb crumb--here" aria-current="page">
                Query editor
              </span>
            </>
          )}
          {schema && !queryOpen && table && (
            <>
              <Chevron />
              <span className="crumb crumb--here mono" aria-current="page">
                {table}
              </span>
            </>
          )}
        </nav>
      </header>
      {queryOpen ? (
        <QueryEditor schema={schema} />
      ) : schema && table ? (
        <TableView key={`${schema}.${table}`} schema={schema} table={table} />
      ) : (
        <div className="state">
          <h2>Pick a table to read it</h2>
          <p>Choose one from the list, or press / to filter.</p>
        </div>
      )}
    </main>
  );
}
