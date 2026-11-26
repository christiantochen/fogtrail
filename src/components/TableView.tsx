import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { rowsKey, useRows, useStructure } from "../api/queries";
import type {
  ColumnInfo,
  ForeignKeyInfo,
  RowPage,
  RowView,
  TableStructure,
} from "../api/types";
import { copyText } from "../lib/clipboard";
import { clockLabel, PAGE_SIZES } from "../lib/pageSize";
import { refreshAll } from "../lib/refreshAll";
import {
  columnSub,
  isArrayType,
  isJsonType,
  jsonOf,
  isNumericType,
  isTimeType,
  jsonSummary,
  nextSort,
  rangeLabel,
  resultToTsv,
  splitTimestamp,
  sqlDialectOf,
  MAX_PINS,
  livePins,
  pinOrder,
} from "../lib/sql";
import { useUi, type SqlTab } from "../state/ui";
import { Dropdown } from "./Dropdown";
import { FilterBar } from "./FilterBar";
import { useForeignKeys, type FkLink } from "./useForeignKeys";
import { ArrowLeftIcon } from "./Icons";
import { ColumnsMenu } from "./ColumnsMenu";
import {
  liveHidden,
  loadHidden,
  saveHidden,
  shownIndexes,
} from "../lib/hiddenColumns";
import { PinButton } from "./PinButton";
import { useColumnPins } from "./useColumnPins";
import { useDelayedFlag } from "./useDelayedFlag";
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
  const shownTab = useUi((s) => s.sqlTab);
  const connected = useUi((s) => s.connected);
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
  // Indexes get a tab of their own where the server can say how each was made.
  const postgres = sqlDialectOf(connected?.driver) === "postgres";
  const tabs: SqlTab[] = postgres
    ? ["data", "structure", "indexes"]
    : ["data", "structure"];
  const tab = tabs.includes(shownTab) ? shownTab : "data";
  return (
    <div className="sqltable">
      {/* The breadcrumb already shows the name; this keeps it for screen readers. */}
      <h1 className="sr-only">{table}</h1>

      <div className="panel sqlpanel">
        <div className="panel__bar">
          <div className="tabs" role="tablist" aria-label="Table views">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                className="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
              >
                {TAB_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        {tab === "data" ? (
          <Data
            schema={schema}
            table={table}
            columns={s?.columns}
            foreignKeys={s?.foreignKeys}
          />
        ) : s && tab === "indexes" ? (
          <Indexes s={s} />
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
  foreignKeys,
}: {
  schema: string;
  table: string;
  columns: ColumnInfo[] | undefined;
  foreignKeys: ForeignKeyInfo[] | undefined;
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
  const pageSize = useUi((s) => s.pageSize);
  const setPageSize = useUi((s) => s.setPageSize);
  const q = useRows(schema, table, offset, view, pageSize);

  const profileId = useUi((s) => s.connectedId) ?? "";
  const pinnedNames = useUi((s) => s.sqlPinned);
  // Columns hidden here are kept for this table on this connection. The rows are read in full;
  // hiding only leaves them out of the grid, the panels and what is copied.
  const [hiddenRaw, setHiddenRaw] = useState(() =>
    loadHidden(profileId, schema, table),
  );
  const setHidden = (next: string[]) => {
    setHiddenRaw(next);
    saveHidden(profileId, schema, table, next);
    // A sort by a column that is no longer shown would be invisible, so it ends here.
    if (sort && next.includes(sort.column)) setSort(null);
  };
  const fullPage = q.data;
  const hidden = fullPage
    ? liveHidden(
        hiddenRaw,
        fullPage.columns.map((c) => c.name),
      )
    : hiddenRaw;
  const shownPage = useMemo(() => {
    if (!fullPage) return undefined;
    const names = fullPage.columns.map((c) => c.name);
    const keep = shownIndexes(names, liveHidden(hiddenRaw, names));
    if (keep.length === names.length) return fullPage;
    return {
      ...fullPage,
      columns: keep.map((i) => fullPage.columns[i]),
      rows: fullPage.rows.map((row) => keep.map((i) => row[i])),
    };
  }, [fullPage, hiddenRaw]);
  const back = useUi((s) => s.sqlBack);
  const goBack = useUi((s) => s.goBack);
  const linkFor = useForeignKeys(schema, foreignKeys, hidden);
  const qc = useQueryClient();
  // While a new page, sort or filter loads, the old rows stay (so the table never blanks),
  // and they are "stale": they can't be opened or copied. The look of loading waits 200 ms.
  const stale = q.isPlaceholderData;
  const loading = useDelayedFlag(q.isFetching, 200);
  // A read stopped by the person leaves the rows from before on screen, not running.
  const cancelled = q.isPlaceholderData && q.fetchStatus === "idle";
  const onCancel = () =>
    void qc.cancelQueries({
      queryKey: rowsKey(schema, table, offset, view, pageSize),
    });
  const bar = (
    <>
      {back && (
        <div className="backbar">
          <button
            type="button"
            className="btn btn--small btn--attention"
            onClick={goBack}
          >
            <ArrowLeftIcon /> Back to {back.table}
          </button>
        </div>
      )}
      <FilterBar
        key={`${table}|${back?.seq ?? 0}`}
        applied={filter}
        onApply={setFilter}
        onRefresh={() => refreshAll(qc)}
        refreshing={q.isFetching}
        extra={
          fullPage && fullPage.columns.length > 1 ? (
            <ColumnsMenu
              columns={fullPage.columns.map((c) => ({
                name: c.name,
                sub: (
                  columns?.find((i) => i.name === c.name)?.dataType ??
                  c.typeName
                ).toLowerCase(),
              }))}
              hidden={hidden}
              pinned={pinnedNames}
              onChange={setHidden}
            />
          ) : undefined
        }
      />
    </>
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
  const shown = shownPage ?? page;
  return (
    <>
      {bar}
      {/* A new page, filter or sort starts with no row open. */}
      <DataGrid
        key={`${offset}|${pageSize}|${filter}|${sort?.column}|${sort?.desc}`}
        schema={schema}
        table={table}
        page={shown}
        hiddenCount={page.columns.length - shown.columns.length}
        info={new Map(columns?.map((c) => [c.name, c]))}
        filtered={filter !== ""}
        sort={sort}
        onSort={setSort}
        offset={offset}
        pageSize={pageSize}
        onPageSize={setPageSize}
        updatedAt={q.dataUpdatedAt}
        fetching={q.isFetching}
        stale={stale}
        loading={loading}
        cancelled={cancelled}
        onCancel={onCancel}
        onRetry={() => void q.refetch()}
        onOffset={setOffset}
        linkFor={(r, column) => linkFor(page.columns, page.rows[r], column)}
      />
    </>
  );
}

function DataGrid({
  schema,
  table,
  page,
  info,
  filtered,
  sort,
  onSort,
  offset,
  pageSize,
  onPageSize,
  updatedAt,
  fetching,
  stale,
  loading,
  cancelled,
  onCancel,
  onRetry,
  onOffset,
  linkFor,
  hiddenCount,
}: {
  schema: string;
  table: string;
  page: RowPage;
  info: Map<string, ColumnInfo>;
  filtered: boolean;
  sort: { column: string; desc: boolean } | null;
  onSort: (sort: { column: string; desc: boolean } | null) => void;
  offset: number;
  pageSize: number;
  onPageSize: (size: number) => void;
  /** When the rows on screen were read, in ms. */
  updatedAt: number;
  fetching: boolean;
  /** These rows belong to the previous page, sort or filter. */
  stale: boolean;
  /** A load has been running long enough to show it. */
  loading: boolean;
  /** The person stopped the load; these rows are from before it. */
  cancelled: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onOffset: (offset: number) => void;
  /** Where a foreign-key value leads, if it does. */
  linkFor: (row: number, column: string) => FkLink | null;
  /** Columns left out of this page by the Columns menu. */
  hiddenCount: number;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // After a jump along a key, the row that was found opens on its own, once.
  const landed = useUi((s) => s.sqlLanded);
  const clearLanded = useUi((s) => s.clearLanded);
  const [landedSeen, setLandedSeen] = useState(false);
  if (landed && !stale && !landedSeen) {
    setLandedSeen(true);
    if (page.rows.length > 0) setOpen(0);
  }
  useEffect(() => {
    if (landed && !stale) clearLanded();
  }, [landed, stale, clearLanded]);
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
  const move = (delta: number) => {
    const next =
      open === null
        ? open
        : Math.min(page.rows.length - 1, Math.max(0, open + delta));
    setOpen(next);
    // Keep the open row visible when it is moved with the arrows or buttons.
    if (next !== null) {
      rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <div className="sqldata">
      <div className="sqldata__main">
        {loading && <div className="loadbar" aria-hidden="true" />}
        <div
          className={`table-wrap sqlwrap${loading && stale ? " sqlwrap--loading" : ""}`}
        >
          <table
            ref={tableRef}
            className="sqlgrid"
            aria-label={`Rows of ${table}`}
            aria-busy={stale}
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
                            {active && loading && (
                              <span
                                className="sorthead__spin"
                                aria-hidden="true"
                              />
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
                  onClick={() => {
                    if (!stale) setOpen(r);
                  }}
                  onKeyDown={(e) => {
                    if (stale && e.key !== "ArrowDown" && e.key !== "ArrowUp")
                      return;
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
                      name={page.columns[i].name}
                      link={stale ? null : linkFor(r, page.columns[i].name)}
                      onOpenJson={() => {
                        if (stale) return;
                        setOpen(r);
                        setDialog({ json: i });
                      }}
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
            {loading ? (
              "Loading…"
            ) : cancelled ? (
              "Cancelled · showing the rows you had"
            ) : (
              <>
                {filtered ? "Filtered · " : ""}
                {rangeLabel(page.offset, page.rows.length)}
              </>
            )}
          </span>
          {!loading && !cancelled && updatedAt > 0 && (
            <span className="muted">· Updated {clockLabel(updatedAt)}</span>
          )}
          {live.length >= MAX_PINS && (
            <span className="sqlfoot__note">
              {MAX_PINS} of {MAX_PINS} columns pinned. Unpin one to pin another.
            </span>
          )}
          <span className="sqlfoot__spacer" />
          {loading && (
            <button
              type="button"
              className="btn btn--small btn--attention"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
          {cancelled && (
            <button type="button" className="btn btn--small" onClick={onRetry}>
              Try again
            </button>
          )}
          <span className="sqlfoot__size">
            <span className="muted">Rows</span>
            <Dropdown
              label="Rows per page"
              value={pageSize}
              onChange={onPageSize}
              disabled={fetching}
              options={PAGE_SIZES.map((n) => ({ value: n, label: String(n) }))}
            />
          </span>
          <button
            type="button"
            className="btn btn--small"
            disabled={page.rows.length === 0 || stale}
            onClick={() =>
              void copyText(resultToTsv(page.columns, page.rows), "rows")
            }
          >
            Copy rows
          </button>
          <button
            type="button"
            className="btn btn--small"
            disabled={offset === 0 || fetching || stale}
            onClick={() => onOffset(Math.max(0, offset - pageSize))}
          >
            Previous
          </button>
          <button
            type="button"
            className="btn btn--small"
            disabled={!page.hasMore || fetching || stale}
            onClick={() => onOffset(offset + pageSize)}
          >
            Next {pageSize}
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
          schema={schema}
          table={table}
          info={info}
          columns={page.columns}
          row={page.rows[open]}
          position={open}
          count={page.rows.length}
          json={dialog.json}
          onMove={move}
          onJson={(json) => setDialog({ json })}
          link={(column) => linkFor(open, column)}
          hiddenCount={hiddenCount}
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
  name,
  link,
  onOpenJson,
}: {
  value: string | null;
  type: string;
  pin?: { left: number; last: boolean };
  /** The column's name, for the JSON chip's label. */
  name: string;
  /** Where this value leads, when its column is a foreign key. */
  link: FkLink | null;
  /** Open the row dialog on this value. */
  onOpenJson: () => void;
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
  if (isJsonType(type) || isArrayType(type)) {
    const field = jsonOf(type, value);
    const summary = field ? jsonSummary(field.pretty) : null;
    if (field && summary)
      return (
        <td className={cls()} style={stick?.style} title={value}>
          <button
            type="button"
            className="jchip jchip--open mono"
            aria-label={`Open ${name}, ${summary}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpenJson();
            }}
            // Enter and Space on the chip open the value, not the row around it.
            onKeyDown={(e) => e.stopPropagation()}
          >
            {field.pretty.startsWith("[") ? "[ ]" : "{ }"} {summary}
          </button>
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
      title={link ? `${value} → ${link.label}` : value}
    >
      {link ? (
        <button
          type="button"
          className="fklink"
          aria-label={`${name} ${value}, open ${link.label}`}
          onClick={(e) => {
            e.stopPropagation();
            link.follow();
          }}
          // Enter and Space on the link follow it, not open the row around it. Other keys
          // (arrows, shortcuts) still reach the row and the window.
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
          }}
        >
          {value}
        </button>
      ) : (
        value
      )}
    </td>
  );
}

const TAB_LABEL: Record<SqlTab, string> = {
  data: "Data",
  structure: "Structure",
  indexes: "Indexes",
};

const KIND_LABEL: Record<string, string> = {
  view: "View",
  matview: "Materialized view",
  foreign: "Foreign table",
  table: "Table",
};

/** PostgreSQL's indexes with the statement behind each, opened one at a time. */
function Indexes({ s }: { s: TableStructure }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="sqlpanel__scroll">
      {s.indexes.length === 0 ? (
        <p className="note">No indexes.</p>
      ) : (
        <table className="sqlgrid sqlgrid--plain" aria-label="Indexes">
          <thead>
            <tr>
              <th>Name</th>
              <th>Columns</th>
              <th>Unique</th>
              <th>Method</th>
            </tr>
          </thead>
          <tbody>
            {s.indexes.map((i) => (
              <Fragment key={i.name}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="linkbtn mono"
                      aria-expanded={open === i.name}
                      onClick={() => setOpen(open === i.name ? null : i.name)}
                    >
                      {i.name}
                    </button>
                  </td>
                  <td className="mono">{i.columns.join(", ")}</td>
                  <td>{i.unique ? "YES" : "NO"}</td>
                  <td>{i.indexType}</td>
                </tr>
                {open === i.name && (
                  <tr>
                    <td colSpan={4}>
                      <pre className="code code--tip">
                        {i.definition ?? "No definition available."}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Structure({ s }: { s: TableStructure }) {
  return (
    <div className="sqlpanel__scroll">
      <dl className="sqlfacts">
        <dt>Kind</dt>
        <dd>{KIND_LABEL[s.kind] ?? "Table"}</dd>
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
