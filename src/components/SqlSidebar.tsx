import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useProfiles, useSchemas, useTables } from "../api/queries";
import { copyText } from "../lib/clipboard";
import { refreshAll } from "../lib/refreshAll";
import {
  approxCompact,
  approxRows,
  filterTables,
  pickSchema,
  visibleSchemas,
} from "../lib/sql";
import { useUi } from "../state/ui";
import { ConnectionSwitch } from "./ConnectionSwitch";
import { Dropdown } from "./Dropdown";
import {
  DatabaseIcon,
  Lock,
  Mark,
  QueryIcon,
  Refresh,
  TableIcon,
} from "./Icons";

/** The sidebar for a SQL connection: databases, then the tables of the open one. */
export function SqlSidebar() {
  const conn = useUi((s) => s.connected);
  const connectedId = useUi((s) => s.connectedId);
  const openConnections = useUi((s) => s.openConnections);
  const schema = useUi((s) => s.sqlSchema);
  const table = useUi((s) => s.sqlTable);
  const selectSchema = useUi((s) => s.selectSchema);
  const selectTable = useUi((s) => s.selectTable);
  const queryOpen = useUi((s) => s.sqlQueryOpen);
  const openQueryEditor = useUi((s) => s.openQueryEditor);
  const profiles = useProfiles();
  const schemas = useSchemas();
  const tables = useTables(schema);
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Open the profile's own database first, once the list is known.
  const preferred =
    profiles.data?.find((p) => p.id === connectedId)?.schema ?? null;
  useEffect(() => {
    if (schema === null && schemas.isSuccess && profiles.isSuccess) {
      selectSchema(pickSchema(schemas.data, preferred));
    }
  }, [
    schema,
    schemas.isSuccess,
    schemas.data,
    profiles.isSuccess,
    preferred,
    selectSchema,
  ]);

  // "/" jumps to the filter, like in the key browser.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === input.current) {
        setFilter("");
        input.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Shift+Cmd/Ctrl+C copies the open table's name.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== "c") return;
      const { sqlSchema, sqlTable } = useUi.getState();
      if (!sqlSchema || !sqlTable) return;
      e.preventDefault();
      void copyText(`${sqlSchema}.${sqlTable}`, "table name");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const all = schemas.data ?? [];
  const shownSchemas = visibleSchemas(all, showSystem, schema);
  const hiddenCount = all.length - shownSchemas.length;
  const list = useMemo(
    () => filterTables(tables.data ?? [], filter),
    [tables.data, filter],
  );
  const status =
    schemas.isError || tables.isError
      ? "err"
      : tables.isSuccess
        ? "on"
        : "idle";

  return (
    <aside className="sidebar">
      <div className="brand">
        <Mark />
        <span>Fogtrail</span>
      </div>

      <div className="card">
        <span
          className={`dot${status === "on" ? " dot--on" : status === "err" ? " dot--err" : ""}`}
        />
        <div className="card__text">
          <ConnectionSwitch />
          <span className="card__sub mono">
            {conn ? `${conn.driver} · ${conn.address}` : " "}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--small"
          onClick={openConnections}
        >
          Manage
        </button>
      </div>

      <div className="sqlpick">
        <span className="section-label">Database</span>
        <div className="schemapick">
          <DatabaseIcon />
          <Dropdown
            label="Database"
            value={schema ?? ""}
            disabled={!schemas.isSuccess}
            onChange={(name) => {
              setFilter("");
              selectSchema(name);
            }}
            options={
              schema === null
                ? [{ value: "", label: "Loading…" }]
                : shownSchemas.map((x) => ({ value: x.name, label: x.name }))
            }
          />
          {schemas.isSuccess && (
            <span className="schemapick__count">
              {Math.max(
                1,
                shownSchemas.findIndex((s) => s.name === schema) + 1,
              )}{" "}
              of {shownSchemas.length}
            </span>
          )}
        </div>
        {schemas.isSuccess && !showSystem && hiddenCount > 0 && (
          <button
            type="button"
            className="more more--tight"
            onClick={() => setShowSystem(true)}
          >
            Show system databases
          </button>
        )}
      </div>

      <div className="filter">
        <div className="filter__box">
          <input
            ref={input}
            type="search"
            aria-label="Filter tables"
            placeholder="Filter tables"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                document
                  .querySelector<HTMLButtonElement>(".tree button.row")
                  ?.focus();
              }
            }}
          />
          <kbd aria-hidden="true">/</kbd>
        </div>
        <button
          type="button"
          className={`icon-btn${tables.isFetching ? " icon-btn--spin" : ""}`}
          aria-label="Refresh tables"
          title={`Refresh (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘R" : "Ctrl+R"})`}
          onClick={() => refreshAll(qc)}
        >
          <Refresh />
        </button>
      </div>

      <button
        type="button"
        className="queryopen"
        aria-current={queryOpen}
        disabled={schema === null}
        onClick={openQueryEditor}
      >
        <QueryIcon />
        <span>Query editor</span>
      </button>

      <div className="section-label">
        Tables{tables.isSuccess ? ` · ${list.length}` : ""}
      </div>

      {(schemas.isPending || tables.isPending) && !schemas.isError && (
        <div aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      )}
      {schemas.isError && (
        <div role="alert" className="alert">
          {schemas.error.message}
        </div>
      )}
      {tables.isError && (
        <div role="alert" className="alert">
          {tables.error.message}
        </div>
      )}
      {tables.isSuccess && list.length === 0 && (
        <div className="note">
          {filter.trim() !== ""
            ? "No table matches."
            : "This database has no tables."}
        </div>
      )}
      {tables.isSuccess && list.length > 0 && (
        <ul className="tree" aria-label="Tables">
          {list.map((t) => (
            <li key={t.name}>
              <button
                type="button"
                className="row"
                aria-current={!queryOpen && t.name === table}
                title={t.name}
                onClick={() => selectTable(t.name)}
              >
                <TableIcon className="row__chev" />
                <span className="row__label">{t.name}</span>
                {t.kind === "view" && <span className="badge">view</span>}
                <span
                  className="row__count"
                  title={
                    t.estimatedRows === null
                      ? undefined
                      : `${approxRows(t.estimatedRows)} rows. An estimate from the server, not an exact count`
                  }
                >
                  {approxCompact(t.estimatedRows)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="sidebar__foot">
        <Lock />
        <span>Read-only session. Writes are blocked by the server.</span>
      </div>
    </aside>
  );
}
