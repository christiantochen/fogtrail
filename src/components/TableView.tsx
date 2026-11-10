import { useQueryClient } from "@tanstack/react-query";
import { useRows, useStructure, useTables } from "../api/queries";
import type { ColumnInfo, TableStructure } from "../api/types";
import { copyText } from "../lib/clipboard";
import { refreshAll } from "../lib/refreshAll";
import {
  ROWS_PER_PAGE,
  approxRows,
  columnSub,
  isNumericType,
  rangeLabel,
} from "../lib/sql";
import { useUi } from "../state/ui";
import { Lock, Refresh } from "./Icons";

/** One table or view: its rows and its structure. */
export function TableView({
  schema,
  table,
}: {
  schema: string;
  table: string;
}) {
  const qc = useQueryClient();
  const tab = useUi((s) => s.sqlTab);
  const setTab = useUi((s) => s.setSqlTab);
  const structure = useStructure(schema, table);
  const tables = useTables(schema);
  const estimate =
    tables.data?.find((t) => t.name === table)?.estimatedRows ?? null;
  const refreshing = structure.isFetching || tables.isFetching;

  if (structure.isError && !structure.data) {
    return (
      <div className="detail">
        <div role="alert" className="alert alert--block">
          {structure.error.message}
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => void structure.refetch()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const s = structure.data;
  return (
    <div className="sqltable">
      <div className="detail__head">
        <div>
          <h1 className="detail__name mono">{table}</h1>
          <div className="chips">
            {s ? (
              <>
                <span className="chip">
                  {s.kind === "view" ? "View" : "Table"}
                </span>
                {s.engine && <span className="chip">{s.engine}</span>}
                {estimate !== null && (
                  <span className="chip">
                    {approxRows(estimate)} rows (estimate)
                  </span>
                )}
                <span className="chip">{s.columns.length} columns</span>
                <span className="chip chip--icon">
                  <Lock width={12} height={12} /> Read-only
                </span>
                {s.comment && <span className="chip">{s.comment}</span>}
              </>
            ) : (
              <span className="skeleton" style={{ width: 240 }} />
            )}
          </div>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => void copyText(`${schema}.${table}`, "table name")}
          >
            Copy name
          </button>
          <button
            type="button"
            className="btn btn--icon"
            onClick={() => refreshAll(qc)}
            aria-label="Refresh table"
          >
            <Refresh className={refreshing ? "spin" : undefined} /> Refresh
          </button>
        </div>
      </div>

      <div className="panel sqlpanel">
        <div className="panel__bar">
          <div className="tabs" role="tablist" aria-label="Table views">
            {(["data", "structure"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {t === "data" ? "Data" : "Structure"}
              </button>
            ))}
          </div>
          <span className="muted">
            {tab === "data" ? `${ROWS_PER_PAGE} rows per page` : null}
          </span>
        </div>
        {tab === "data" ? (
          <Data schema={schema} table={table} columns={s?.columns} />
        ) : s ? (
          <Structure s={s} />
        ) : (
          <div className="skeleton" style={{ height: 120, margin: 16 }} />
        )}
      </div>
    </div>
  );
}

function Data({
  schema,
  table,
  columns,
}: {
  schema: string;
  table: string;
  columns: ColumnInfo[] | undefined;
}) {
  const offset = useUi((s) => s.sqlOffset);
  const setOffset = useUi((s) => s.setSqlOffset);
  const q = useRows(schema, table, offset);

  if (q.isError && !q.data) {
    return (
      <div className="sqlpanel__body">
        <div role="alert" className="alert alert--block">
          {q.error.message}
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => void q.refetch()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!q.data) {
    return (
      <div className="sqlpanel__body" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="skeleton" key={i} />
        ))}
      </div>
    );
  }

  const page = q.data;
  const info = new Map(columns?.map((c) => [c.name, c]));
  return (
    <>
      <div className="table-wrap sqlwrap">
        <table className="sqlgrid" aria-label={`Rows of ${table}`}>
          <thead>
            <tr>
              {page.columns.map((c) => {
                const numeric = isNumericType(c.typeName);
                return (
                  <th key={c.name} className={numeric ? "num" : undefined}>
                    <span className="sqlgrid__name">{c.name}</span>
                    <span className="sqlgrid__sub mono">
                      {columnSub(c, info.get(c.name))}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => {
                  const numeric = isNumericType(page.columns[i].typeName);
                  return cell === null ? (
                    <td key={i} className="sqlgrid__null">
                      NULL
                    </td>
                  ) : (
                    <td
                      key={i}
                      className={numeric ? "num" : undefined}
                      title={cell}
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {page.rows.length === 0 && (
          <div className="note">
            {offset > 0 ? "No more rows." : "This table has no rows."}
          </div>
        )}
      </div>
      <div className="sqlfoot">
        <span>{rangeLabel(page.offset, page.rows.length)}</span>
        <span className="sqlfoot__spacer" />
        <button
          type="button"
          className="btn btn--small"
          disabled={offset === 0 || q.isFetching}
          onClick={() => setOffset(offset - ROWS_PER_PAGE)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={!page.hasMore || q.isFetching}
          onClick={() => setOffset(offset + ROWS_PER_PAGE)}
        >
          Next {ROWS_PER_PAGE}
        </button>
      </div>
    </>
  );
}

function Structure({ s }: { s: TableStructure }) {
  return (
    <div className="sqlpanel__scroll">
      <h2 className="sqlsection">Columns</h2>
      <table className="sqlgrid sqlgrid--plain" aria-label="Columns">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Null</th>
            <th>Key</th>
            <th>Default</th>
            <th>Extra</th>
          </tr>
        </thead>
        <tbody>
          {s.columns.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td>{c.dataType}</td>
              <td>{c.nullable ? "YES" : "NO"}</td>
              <td>{c.key ?? ""}</td>
              {c.default !== null ? (
                <td>{c.default}</td>
              ) : c.nullable ? (
                <td className="sqlgrid__null">NULL</td>
              ) : (
                // The server reports "no default" and "default NULL" the same way; only a
                // nullable column can really default to NULL.
                <td />
              )}
              <td title={c.comment ?? undefined}>
                {[c.extra, c.comment].filter(Boolean).join(" · ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="sqlsection">Indexes</h2>
      {s.indexes.length === 0 ? (
        <p className="note">No indexes.</p>
      ) : (
        <table className="sqlgrid sqlgrid--plain" aria-label="Indexes">
          <thead>
            <tr>
              <th>Name</th>
              <th>Columns</th>
              <th>Unique</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {s.indexes.map((i) => (
              <tr key={i.name}>
                <td>{i.name}</td>
                <td>{i.columns.join(", ")}</td>
                <td>{i.unique ? "YES" : "NO"}</td>
                <td>{i.indexType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="sqlsection">Foreign keys</h2>
      {s.foreignKeys.length === 0 ? (
        <p className="note">No foreign keys.</p>
      ) : (
        <table className="sqlgrid sqlgrid--plain" aria-label="Foreign keys">
          <thead>
            <tr>
              <th>Name</th>
              <th>Columns</th>
              <th>References</th>
            </tr>
          </thead>
          <tbody>
            {s.foreignKeys.map((f) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td>{f.columns.join(", ")}</td>
                <td>
                  {f.refSchema}.{f.refTable} ({f.refColumns.join(", ")})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
