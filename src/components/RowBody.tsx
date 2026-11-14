import { Fragment, useMemo, useRef, useState } from "react";
import type { ColumnInfo, ResultColumn } from "../api/types";
import { copyText } from "../lib/clipboard";
import { placeOf, type HitPlace, type RowHits } from "../lib/rowFind";
import type { Range } from "../lib/find";
import {
  groupColumns,
  kindOf,
  typeBadge,
  type KindFilter,
} from "../lib/rowGroups";
import {
  isTimeType,
  jsonSummary,
  livePins,
  MAX_PINS,
  splitRow,
  utcOf,
} from "../lib/sql";
import { Marked } from "./Marked";
import { JsonSection } from "./JsonSection";
import { Chevron, CopyIcon, FolderIcon, Lock, Pin } from "./Icons";

/** A column name that wraps after an underscore, not in the middle of a word, with search matches marked. */
function Breakable({
  name,
  ranges = [],
  current = -1,
}: {
  name: string;
  ranges?: readonly Range[];
  current?: number;
}) {
  let at = 0;
  return name.split("_").map((part, i) => {
    const sepAt = at;
    if (i > 0) at += 1;
    const partAt = at;
    at += part.length;
    return (
      <Fragment key={i}>
        {i > 0 && (
          <>
            <Marked text="_" offset={sepAt} ranges={ranges} current={current} />
            <wbr />
          </>
        )}
        <Marked text={part} offset={partAt} ranges={ranges} current={current} />
      </Fragment>
    );
  });
}

/** A small chip for a null cell. Under a search it takes the highlight, whole. */
function NullChip({ hit, current }: { hit: boolean; current: boolean }) {
  return (
    <span
      className={`nullchip mono${hit ? " nullchip--hit" : ""}${current ? " nullchip--current" : ""}`}
      data-current={current ? "true" : undefined}
    >
      null
    </span>
  );
}

/** A JSON value in the list: what it holds, any search matches inside it, and a button to open it. */
function JsonChip({
  summary,
  matches,
  current,
  index,
  onOpen,
}: {
  summary: string;
  matches: number;
  current: boolean;
  index: number;
  onOpen: () => void;
}) {
  return (
    <span className="jsonchip">
      <span className="jsonchip__what mono">
        {summary.endsWith("items") || summary.endsWith("item") ? "[ ]" : "{ }"}{" "}
        {summary}
      </span>
      {matches > 0 && (
        <span
          className={`jsonchip__match${current ? " jsonchip__match--current" : ""}`}
          data-current={current ? "true" : undefined}
        >
          {matches} match{matches === 1 ? "" : "es"}
        </span>
      )}
      <button
        type="button"
        className="btn btn--small"
        data-open={index}
        onClick={onOpen}
      >
        Open
      </button>
    </span>
  );
}

/**
 * What a row holds. The side panel lists its plain columns, then its JSON values (folded one
 * level, one can be sent to the dialog). The dialog lists every column in table order: a null
 * is a small chip, a JSON value is a chip with an Open button.
 */
export function RowBody({
  columns,
  row,
  variant,
  onExpand,
  onOpenJson,
  dialog,
}: {
  columns: ResultColumn[];
  row: (string | null)[];
  variant: "panel" | "dialog";
  /** Panel only: open the dialog on this column's JSON. */
  onExpand?: (column: number) => void;
  /** Dialog only: show this column's JSON value on its own. */
  onOpenJson?: (column: number) => void;
  /** Dialog only: what the list needs besides the row. */
  dialog?: DialogOptions;
}) {
  const { plain, json } = useMemo(() => splitRow(columns, row), [columns, row]);

  if (variant === "panel") {
    return (
      <div className="rowpanel__body">
        <dl className="rowfields">
          {plain.map((i) => (
            <div key={columns[i].name} className="rowfields__item">
              <dt className="mono">
                <Breakable name={columns[i].name} />
              </dt>
              {row[i] === null ? (
                <dd className="mono sqlgrid__null">NULL</dd>
              ) : (
                <dd className="mono">{row[i]}</dd>
              )}
            </div>
          ))}
        </dl>
        {json.map((f) => (
          <JsonSection
            key={f.index}
            name={columns[f.index].name}
            field={f}
            startFolded
            onExpand={onExpand ? () => onExpand(f.index) : undefined}
          />
        ))}
      </div>
    );
  }

  return (
    <DialogList
      columns={columns}
      row={row}
      json={json}
      onOpenJson={onOpenJson}
      options={dialog}
    />
  );
}

/** What the dialog's list needs besides the row: the search, the filters, the pins, the groups. */
export interface DialogOptions {
  find: { term: string; hits: RowHits; current: number };
  /** Leave out the columns whose value is null (while not searching). */
  hideNull: boolean;
  onHideNull: (hide: boolean) => void;
  /** What the structure says about each column, by name. */
  info: Map<string, ColumnInfo>;
  /** Pinned column names, in the order they were pinned. */
  pinned: string[];
  onPin: (name: string) => void;
  kind: KindFilter;
  /** A wide table: columns come in groups under their own headings, with a rail to jump. */
  grouped: boolean;
  collapsed: ReadonlySet<string>;
  onCollapsed: (next: Set<string>) => void;
}

const PLAIN: DialogOptions = {
  find: { term: "", hits: { fields: [], total: 0 }, current: 0 },
  hideNull: false,
  onHideNull: () => undefined,
  info: new Map(),
  pinned: [],
  onPin: () => undefined,
  kind: "all",
  grouped: false,
  collapsed: new Set(),
  onCollapsed: () => undefined,
};

/** A value is cut to one line when it is longer than this, and opens in full on a click. */
const LONG = 48;

/**
 * The dialog's list: every column of the row, one per line, with its type, its value, a copy
 * button and a pin button. Pinned columns sit in a band above the scroll. A wide table is
 * grouped by name prefix, with a rail to jump between groups.
 */
function DialogList({
  columns,
  row,
  json,
  onOpenJson,
  options,
}: {
  columns: ResultColumn[];
  row: (string | null)[];
  json: ReturnType<typeof splitRow>["json"];
  onOpenJson?: (column: number) => void;
  options: DialogOptions | undefined;
}) {
  const o = options ?? PLAIN;
  const { find, hideNull, info, pinned, kind, grouped, collapsed } = o;
  const list = useRef<HTMLDivElement>(null);
  const [wrapped, setWrapped] = useState<ReadonlySet<number>>(new Set());
  const [at, setAt] = useState<string | null>(null);

  const searching = find.term !== "";
  const place: HitPlace | null = searching
    ? placeOf(find.hits, find.current)
    : null;
  const here = (kindOfHit: HitPlace["kind"], index: number) =>
    place && place.kind === kindOfHit && place.index === index
      ? place.local
      : -1;
  const matched = searching
    ? new Map(find.hits.fields.map((f) => [f.index, f]))
    : null;
  const jsonAt = new Map(json.map((f) => [f.index, f]));
  const names = columns.map((c) => c.name);
  const all = columns.map((_, i) => i);
  const pinnedAt = livePins(names, pinned).map((n) => names.indexOf(n));
  const nulls = row.filter((v) => v === null).length;
  const hiding = !searching && hideNull && nulls > 0;
  const kindOk = (i: number) =>
    kind === "all" || kindOf(columns[i].typeName, jsonAt.has(i)) === kind;
  // Pinned columns stay put under a filter or Hide NULL; only a search can remove them.
  const band = pinnedAt.filter((i) => (matched ? matched.has(i) : true));
  const listed = (i: number) =>
    !pinnedAt.includes(i) &&
    kindOk(i) &&
    (matched ? matched.has(i) : !(hiding && row[i] === null));
  const flat = all.filter(listed);
  const shown = band.length + flat.length;
  const nullsHidden = hiding
    ? all.filter((i) => row[i] === null && !pinnedAt.includes(i) && kindOk(i))
        .length
    : 0;
  const count = searching
    ? `${shown} of ${columns.length} columns match`
    : `Showing ${shown} of ${columns.length} columns${nullsHidden > 0 ? ` · ${nullsHidden} NULL hidden` : ""}`;

  const groups = grouped
    ? groupColumns(names)
        .map((g) => ({ ...g, shown: g.columns.filter(listed) }))
        .filter((g) => g.shown.length > 0)
    : [];
  const setCount = (g: { columns: number[] }) =>
    g.columns.filter((i) => row[i] !== null).length;
  const current = at ?? groups[0]?.name ?? null;

  // The rail follows the scroll: the group whose heading is at, or above, the top.
  const spy = () => {
    const el = list.current;
    if (!el) return;
    let found: string | null = null;
    for (const h of el.querySelectorAll<HTMLElement>("[data-group]")) {
      if (h.offsetTop <= el.scrollTop + 8) found = h.dataset.group ?? null;
      else break;
    }
    setAt(found);
  };
  const jump = (name: string) => {
    if (collapsed.has(name)) {
      const next = new Set(collapsed);
      next.delete(name);
      o.onCollapsed(next);
    }
    setAt(name);
    requestAnimationFrame(() =>
      list.current
        ?.querySelector(`[data-group="${CSS.escape(name)}"]`)
        ?.scrollIntoView?.({ block: "start" }),
    );
  };
  const toggleGroup = (name: string) => {
    const next = new Set(collapsed);
    if (!next.delete(name)) next.add(name);
    o.onCollapsed(next);
  };
  const allClosed =
    groups.length > 0 && groups.every((g) => collapsed.has(g.name));
  const value = (i: number) => {
    const f = matched?.get(i);
    const field = jsonAt.get(i);
    if (field)
      return (
        <JsonChip
          summary={jsonSummary(field.pretty) ?? "JSON"}
          matches={f?.json ?? 0}
          current={here("json", i) === 0}
          index={i}
          onOpen={() => onOpenJson?.(i)}
        />
      );
    if (row[i] === null)
      return (
        <NullChip
          hit={(f?.value.length ?? 0) > 0}
          current={here("value", i) === 0}
        />
      );
    const text = row[i] as string;
    // A time with an offset also says what it is in UTC.
    const utc = isTimeType(columns[i].typeName) ? utcOf(text) : null;
    const marked = (
      <Marked text={text} ranges={f?.value ?? []} current={here("value", i)} />
    );
    // A long value is one line until it is clicked; a search match inside it opens it.
    const long = text.length > LONG || text.includes("\n");
    const open = wrapped.has(i) || (f?.value.length ?? 0) > 0;
    return (
      <>
        {long ? (
          <button
            type="button"
            className={`rowfields__text mono${open ? " rowfields__text--open" : ""}`}
            aria-expanded={open}
            title={open ? undefined : text.slice(0, 500)}
            onClick={() =>
              setWrapped((w) => {
                const next = new Set(w);
                if (!next.delete(i)) next.add(i);
                return next;
              })
            }
          >
            {marked}
          </button>
        ) : (
          <span className="mono">{marked}</span>
        )}
        {utc && <span className="rowfields__utc mono">= {utc}</span>}
      </>
    );
  };

  const item = (i: number, isPinned: boolean) => {
    const f = matched?.get(i);
    const name = columns[i].name;
    const isNull = row[i] === null;
    return (
      <div key={name} className="rowfields__item" data-col={name}>
        <dt className="rowfields__name">
          <span
            className={`rowfields__id mono${isNull ? " rowfields__dim" : ""}`}
            title={name}
          >
            <Breakable name={name} ranges={f?.name} current={here("name", i)} />
          </span>
          <span className="badge mono">
            {typeBadge(columns[i], info.get(name))}
          </span>
        </dt>
        <dd className="rowfields__value">{value(i)}</dd>
        <dd
          className={`rowfields__actions${isPinned ? " rowfields__actions--on" : ""}`}
        >
          <button
            type="button"
            className="iconbtn"
            aria-label={`Copy ${name}`}
            disabled={isNull}
            onClick={() => void copyText(row[i] as string, name)}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            className={`iconbtn${isPinned ? " iconbtn--on" : ""}`}
            aria-label={`${isPinned ? "Unpin" : "Pin"} ${name}`}
            aria-pressed={isPinned}
            disabled={!isPinned && pinnedAt.length >= MAX_PINS}
            title={
              !isPinned && pinnedAt.length >= MAX_PINS
                ? `Up to ${MAX_PINS} columns can be pinned`
                : undefined
            }
            onClick={() => o.onPin(name)}
          >
            <Pin />
          </button>
        </dd>
      </div>
    );
  };

  return (
    <div className="rowdialog__body">
      <div className="rowdialog__main">
        {grouped && groups.length > 0 && (
          <nav className="rowrail" aria-label="Column groups">
            <span className="section-label">Groups by name prefix</span>
            {groups.map((g) => (
              <button
                key={g.name}
                type="button"
                className="rowrail__item"
                aria-current={g.name === current ? "true" : undefined}
                onClick={() => jump(g.name)}
              >
                <FolderIcon />
                <span className="mono rowrail__name">{g.name}</span>
                <span className="rowrail__count">
                  {setCount(g)}
                  <span>/{g.columns.length}</span>
                </span>
              </button>
            ))}
            <p className="rowrail__note">
              {columns.length - nulls} of {columns.length} columns have a value.
              Numbers show set / total.
            </p>
          </nav>
        )}
        <div className="rowdialog__col">
          {band.length > 0 && (
            <div className="rowband">
              <div className="rowband__head">
                <Pin />
                <span className="section-label">Pinned · {band.length}</span>
                <span className="rowband__hint">
                  Pinned columns stay here while you scroll
                </span>
              </div>
              <dl className="rowfields">{band.map((i) => item(i, true))}</dl>
            </div>
          )}
          <div
            ref={list}
            className="rowdialog__fieldsbody"
            onScroll={grouped ? spy : undefined}
          >
            {flat.length === 0 ? (
              band.length === 0 && (
                <p className="rowdialog__none">
                  {searching ? "No columns match." : "No columns to show."}
                </p>
              )
            ) : grouped ? (
              groups.map((g) => {
                const closed = !searching && collapsed.has(g.name);
                return (
                  <section key={g.name} className="rowgroup">
                    <button
                      type="button"
                      className="rowgroup__head"
                      data-group={g.name}
                      aria-expanded={!closed}
                      onClick={() => toggleGroup(g.name)}
                    >
                      <Chevron
                        className={closed ? "" : "rowgroup__chev--open"}
                      />
                      <span className="mono rowgroup__name">{g.name}</span>
                      <span className="rowgroup__count">
                        {setCount(g)} of {g.columns.length} set
                      </span>
                    </button>
                    {!closed && (
                      <dl className="rowfields">
                        {g.shown.map((i) => item(i, false))}
                      </dl>
                    )}
                  </section>
                );
              })
            ) : (
              <dl className="rowfields">{flat.map((i) => item(i, false))}</dl>
            )}
          </div>
        </div>
      </div>
      <div className="rowdialog__foot">
        <Lock />
        <span className="rowdialog__count">{count}</span>
        <span className="rowdialog__spacer" />
        {groups.length > 0 && (
          <button
            type="button"
            className="btn btn--small btn--quiet"
            onClick={() =>
              o.onCollapsed(
                allClosed ? new Set() : new Set(groups.map((g) => g.name)),
              )
            }
          >
            {allClosed ? "Expand all groups" : "Collapse all groups"}
          </button>
        )}
        {nulls > 0 && !searching && (
          <button
            type="button"
            className="btn btn--small btn--quiet"
            onClick={() => o.onHideNull(!hideNull)}
          >
            {hideNull ? "Show NULL columns" : "Hide NULL columns"}
          </button>
        )}
      </div>
    </div>
  );
}
