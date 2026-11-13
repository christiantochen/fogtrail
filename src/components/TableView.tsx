import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useRows, useStructure } from "../api/queries";
import type {
  ColumnInfo,
  RowPage,
  RowView,
  TableStructure,
} from "../api/types";
import { copyText } from "../lib/clipboard";
import { refreshAll } from "../lib/refreshAll";
import {
  ROWS_PER_PAGE,
  columnSub,
  isJsonType,
  isNumericType,
  isTimeType,
  jsonSummary,
  nextSort,
  rangeLabel,
  resultToTsv,
  splitTimestamp,
  MAX_PINS,
  livePins,
  pinOrder,
} from "../lib/sql";
import { useUi } from "../state/ui";
import { FilterBar } from "./FilterBar";
import { PinButton } from "./PinButton";
import { useColumnPins } from "./useColumnPins";
import { RowDialog } from "./RowDialog";
import { RowPanel } from "./RowPanel";

/** One table or view: its rows and its structure. */
export function TableView({
  schema,
  table,
}: {
  schema: string;
  table: string;
}) {
  const tab = useUi((s) => s.sqlTab);
  const setTab = useUi((s) => s.setSqlTab);
  const structure = useStructure(schema, table);

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
      {/* The breadcrumb already shows the name; this keeps it for screen readers. */}
      <h1 className="sr-only">{table}</h1>

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
  const filter = useUi((s) => s.sqlFilter);
  const setFilter = useUi((s) => s.setSqlFilter);
  const sort = useUi((s) => s.sqlSort);
  const setSort = useUi((s) => s.setSqlSort);
  const view: RowView = {
    ...(filter !== "" ? { filter } : {}),
    ...(sort ? { sortColumn: sort.column, sortDesc: sort.desc } : {}),
  };
  const q = useRows(schema, table, offset, view);

  const qc = useQueryClient();
  const bar = (
    <FilterBar
      key={table}
      applied={filter}
      onApply={setFilter}
      onRefresh={() => refreshAll(qc)}
      refreshing={q.isFetching}
    />
  );

  if (q.isError) {
    const blocked = q.error.kind === "blocked";
    return (
      <>
        {bar}
        <div className="sqlpanel__body">
          <div role="alert" className="alert alert--block">
            <span>
              {blocked && <strong>Blocked. </strong>}
              {q.error.message}
            </span>
          </div>
          {filter === "" && (
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() => void q.refetch()}
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </>
    );
  }
  if (!q.data) {
    return (
      <>
        {bar}
        <div className="sqlpanel__body" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      </>
    );
  }

  const page = q.data;
  return (
    <>
      {bar}
      {/* A new page, filter or sort starts with no row open. */}
      <DataGrid
        key={`${offset}|${filter}|${sort?.column}|${sort?.desc}`}
        table={table}
        page={page}
        info={new Map(columns?.map((c) => [c.name, c]))}
        filtered={filter !== ""}
        sort={sort}
        onSort={setSort}
        offset={offset}
        fetching={q.isFetching}
        onOffset={setOffset}
      />
    </>
  );
}

function DataGrid({
  table,
  page,
  info,
  filtered,
  sort,
  onSort,
  offset,
  fetching,
  onOffset,
}: {
  table: string;
  page: RowPage;
  info: Map<string, ColumnInfo>;
  filtered: boolean;
  sort: { column: string; desc: boolean } | null;
  onSort: (sort: { column: string; desc: boolean } | null) => void;
  offset: number;
  fetching: boolean;
  onOffset: (offset: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // The row dialog: on the whole row (json null) or on one column's JSON.
  const [dialog, setDialog] = useState<{ json: number | null } | null>(null);
  const pinned = useUi((s) => s.sqlPinned);
  const togglePinned = useUi((s) => s.togglePinnedColumn);
  const tableRef = useRef<HTMLTableElement>(null);
  const names = page.columns.map((c) => c.name);
  const live = livePins(names, pinned);
  const order = pinOrder(names, pinned);
  const lefts = useColumnPins(tableRef, live, page);
  const pinOf = (name: string) =>
    name in lefts
      ? { left: lefts[name], last: name === live[live.length - 1] }
      : undefined;
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const move = (delta: number) =>
    setOpen((i) =>
      i === null ? i : Math.min(page.rows.length - 1, Math.max(0, i + delta)),
    );

  return (
    <div className="sqldata">
      <div className="sqldata__main">
        <div className="table-wrap sqlwrap">
          <table
            ref={tableRef}
            className="sqlgrid"
            aria-label={`Rows of ${table}`}
          >
            <thead>
              <tr>
                {order.map((ci) => {
                  const c = page.columns[ci];
                  const numeric = isNumericType(c.typeName);
                  const active = sort?.column === c.name ? sort : null;
                  const pin = pinOf(c.name);
                  const isPinned = live.includes(c.name);
                  return (
                    <th
                      key={c.name}
                      data-col={c.name}
                      className={
                        [
                          numeric ? "num" : "",
                          isPinned ? "pinned" : "",
                          pin?.last ? "pinned--last" : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      style={pin ? { left: pin.left } : undefined}
                      aria-sort={
                        active
                          ? active.desc
                            ? "descending"
                            : "ascending"
                          : undefined
                      }
                    >
                      <div className="colhead">
                        <button
                          type="button"
                          className={`sorthead${active ? " sorthead--on" : ""}`}
                          title="Sort by this column"
                          onClick={() => onSort(nextSort(sort, c.name))}
                        >
                          <span className="sqlgrid__name">
                            {c.name}
                            {active && (
                              <span
                                className="sorthead__arrow"
                                aria-hidden="true"
                              >
                                {active.desc ? "↓" : "↑"}
                              </span>
                            )}
                          </span>
                          <span className="sqlgrid__sub mono">
                            {columnSub(c, info.get(c.name))}
                          </span>
                        </button>
                        <PinButton
                          name={c.name}
                          pinned={isPinned}
                          full={live.length >= MAX_PINS}
                          onToggle={() => togglePinned(c.name)}
                        />
                      </div>
                    </th>
                  );
                })}
                <th className="sqlgrid__fill" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row, r) => (
                <tr
                  key={r}
                  ref={(el) => {
                    rowRefs.current[r] = el;
                  }}
                  tabIndex={0}
                  className={open === r ? "sqlrow sqlrow--open" : "sqlrow"}
                  aria-current={open === r ? "true" : undefined}
                  onClick={() => setOpen(r)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpen(r);
                    } else if (
                      e.key === "e" &&
                      !e.metaKey &&
                      !e.ctrlKey &&
                      !e.altKey
                    ) {
                      e.preventDefault();
                      setOpen(r);
                      setDialog({ json: null });
                    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      rowRefs.current[
                        r + (e.key === "ArrowDown" ? 1 : -1)
                      ]?.focus();
                    }
                  }}
                >
                  {order.map((i) => (
                    <Cell
                      key={i}
                      value={row[i]}
                      type={page.columns[i].typeName}
                      pin={pinOf(page.columns[i].name)}
                    />
                  ))}
                  <td className="sqlgrid__fill" aria-hidden="true" />
                </tr>
              ))}
            </tbody>
          </table>
          {page.rows.length === 0 && (
            <div className="note">
              {filtered
                ? "No rows match this filter. Clear it to see all rows."
                : offset > 0
                  ? "No more rows."
                  : "This table has no rows."}
            </div>
          )}
        </div>
        <div className="sqlfoot">
          <span>
            {filtered ? "Filtered · " : ""}
            {rangeLabel(page.offset, page.rows.length)}
          </span>
          {live.length >= MAX_PINS && (
            <span className="sqlfoot__note">
              {MAX_PINS} of {MAX_PINS} columns pinned. Unpin one to pin another.
            </span>
          )}
          <span className="sqlfoot__spacer" />
          <button
            type="button"
            className="btn btn--small"
            disabled={page.rows.length === 0}
            onClick={() =>
              void copyText(resultToTsv(page.columns, page.rows), "rows")
            }
          >
            Copy rows
          </button>
          <button
            type="button"
            className="btn btn--small"
            disabled={offset === 0 || fetching}
            onClick={() => onOffset(offset - ROWS_PER_PAGE)}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn btn--small"
            disabled={!page.hasMore || fetching}
            onClick={() => onOffset(offset + ROWS_PER_PAGE)}
          >
            Next {ROWS_PER_PAGE}
          </button>
        </div>
      </div>
      {open !== null && page.rows[open] && (
        <RowPanel
          table={table}
          columns={page.columns}
          row={page.rows[open]}
          position={open}
          count={page.rows.length}
          onMove={move}
          onClose={() => {
            const was = open;
            setOpen(null);
            rowRefs.current[was]?.focus();
          }}
          onExpand={(json) => setDialog({ json })}
        />
      )}
      {dialog && open !== null && page.rows[open] && (
        <RowDialog
          table={table}
          columns={page.columns}
          row={page.rows[open]}
          position={open}
          count={page.rows.length}
          json={dialog.json}
          onMove={move}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/** One cell: NULL apart from empty text, JSON as a small chip, a timestamp with a quiet time. */
function Cell({
  value,
  type,
  pin,
}: {
  value: string | null;
  type: string;
  pin?: { left: number; last: boolean };
}) {
  const stick = pin
    ? {
        style: { left: pin.left },
        pinned: `pinned${pin.last ? " pinned--last" : ""}`,
      }
    : null;
  const cls = (...c: (string | undefined)[]) =>
    [...c, stick?.pinned].filter(Boolean).join(" ") || undefined;
  if (value === null)
    return (
      <td className={cls("sqlgrid__null")} style={stick?.style}>
        NULL
      </td>
    );
  const numeric = isNumericType(type);
  if (isJsonType(type)) {
    const summary = jsonSummary(value);
    if (summary)
      return (
        <td className={cls()} style={stick?.style} title={value}>
          <span className="jchip mono">
            {"{ }"} {summary}
          </span>
        </td>
      );
  }
  if (isTimeType(type)) {
    const parts = splitTimestamp(value);
    if (parts)
      return (
        <td className={cls()} style={stick?.style} title={value}>
          {parts[0]} <span className="sqlgrid__time">{parts[1]}</span>
        </td>
      );
  }
  return (
    <td
      className={cls(numeric ? "num" : undefined)}
      style={stick?.style}
      title={value}
    >
      {value}
    </td>
  );
}

function Structure({ s }: { s: TableStructure }) {
  return (
    <div className="sqlpanel__scroll">
      <dl className="sqlfacts">
        <dt>Kind</dt>
        <dd>{s.kind === "view" ? "View" : "Table"}</dd>
        {s.engine && (
          <>
            <dt>Engine</dt>
            <dd>{s.engine}</dd>
          </>
        )}
        {s.comment && (
          <>
            <dt>Comment</dt>
            <dd>{s.comment}</dd>
          </>
        )}
      </dl>
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
