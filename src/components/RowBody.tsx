import { Fragment, useMemo } from "react";
import type { ResultColumn } from "../api/types";
import { placeOf, type HitPlace, type RowHits } from "../lib/rowFind";
import type { Range } from "../lib/find";
import { jsonSummary, splitRow } from "../lib/sql";
import { Marked } from "./Marked";
import { JsonSection } from "./JsonSection";

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
  find,
  hideNull,
}: {
  columns: ResultColumn[];
  row: (string | null)[];
  variant: "panel" | "dialog";
  /** Panel only: open the dialog on this column's JSON. */
  onExpand?: (column: number) => void;
  /** Dialog only: show this column's JSON value on its own. */
  onOpenJson?: (column: number) => void;
  /** Dialog only: the search. Columns that don't match are left out, and matches are marked. */
  find?: { term: string; hits: RowHits; current: number };
  /** Dialog only: leave out the columns whose value is null (while not searching). */
  hideNull?: boolean;
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

  const searching = find !== undefined && find.term !== "";
  const place: HitPlace | null = searching
    ? placeOf(find.hits, find.current)
    : null;
  const here = (kind: HitPlace["kind"], index: number) =>
    place && place.kind === kind && place.index === index ? place.local : -1;
  const matched = searching
    ? new Map(find.hits.fields.map((f) => [f.index, f]))
    : null;
  const jsonAt = new Map(json.map((f) => [f.index, f]));
  const all = columns.map((_, i) => i);
  const nulls = row.filter((v) => v === null).length;
  const hiding = !searching && hideNull === true && nulls > 0;
  const shown = matched
    ? all.filter((i) => matched.has(i))
    : hiding
      ? all.filter((i) => row[i] !== null)
      : all;
  const count = searching
    ? `${shown.length} of ${columns.length} match`
    : hiding
      ? `${shown.length} of ${columns.length} shown · ${nulls} null hidden`
      : columns.length;

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
    return (
      <span className="mono">
        <Marked
          text={row[i] as string}
          ranges={f?.value ?? []}
          current={here("value", i)}
        />
      </span>
    );
  };

  return (
    <div className="rowdialog__body">
      <div className="rowdialog__fieldshead">
        <span className="section-label">Columns</span>
        <span className="rowdialog__count">{count}</span>
      </div>
      <div className="rowdialog__fieldsbody">
        {searching && shown.length === 0 ? (
          <p className="rowdialog__none">No columns match.</p>
        ) : (
          <dl className="rowfields">
            {shown.map((i) => {
              const f = matched?.get(i);
              return (
                <div key={columns[i].name} className="rowfields__item">
                  <dt
                    className={`mono${row[i] === null ? " rowfields__dim" : ""}`}
                  >
                    <Breakable
                      name={columns[i].name}
                      ranges={f?.name}
                      current={here("name", i)}
                    />
                  </dt>
                  <dd>{value(i)}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </div>
  );
}
