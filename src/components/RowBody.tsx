import { Fragment, useMemo } from "react";
import type { ResultColumn } from "../api/types";
import {
  NULL_TEXT,
  placeOf,
  type HitPlace,
  type RowHits,
} from "../lib/rowFind";
import type { Range } from "../lib/find";
import { splitRow } from "../lib/sql";
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

/**
 * What a row holds: its plain columns as a list, then its JSON values. The side panel and the
 * dialog both show it. The panel opens the JSON folded one level and can send one value to
 * the dialog; the dialog opens it all.
 */
export function RowBody({
  columns,
  row,
  variant,
  onExpand,
  find,
}: {
  columns: ResultColumn[];
  row: (string | null)[];
  variant: "panel" | "dialog";
  /** Panel only: open the dialog on this column's JSON. */
  onExpand?: (column: number) => void;
  /** Dialog only: the search. Fields that don't match are left out, and matches are marked. */
  find?: { term: string; hits: RowHits; current: number };
}) {
  const { plain, json } = useMemo(() => splitRow(columns, row), [columns, row]);
  const panel = variant === "panel";
  const searching = !panel && find !== undefined && find.term !== "";
  const place: HitPlace | null = searching
    ? placeOf(find.hits, find.current)
    : null;
  const here = (kind: "name" | "value", index: number) =>
    place && place.kind === kind && place.index === index ? place.local : -1;
  const matched = searching
    ? new Map(find.hits.fields.map((f) => [f.index, f]))
    : null;
  const shown = matched ? plain.filter((i) => matched.has(i)) : plain;

  const list =
    searching && shown.length === 0 ? (
      <p className="rowdialog__none">No columns match.</p>
    ) : (
      <dl className="rowfields">
        {shown.map((i) => {
          const f = matched?.get(i);
          return (
            <div key={columns[i].name} className="rowfields__item">
              <dt className="mono">
                <Breakable
                  name={columns[i].name}
                  ranges={f?.name}
                  current={here("name", i)}
                />
              </dt>
              <dd className={`mono${row[i] === null ? " sqlgrid__null" : ""}`}>
                <Marked
                  text={row[i] ?? NULL_TEXT}
                  ranges={f?.value ?? []}
                  current={here("value", i)}
                />
              </dd>
            </div>
          );
        })}
      </dl>
    );
  const sections = json.map((f) => (
    <JsonSection
      key={f.index}
      name={columns[f.index].name}
      field={f}
      startFolded={panel}
      onExpand={panel && onExpand ? () => onExpand(f.index) : undefined}
      ranges={
        searching
          ? find.hits.json.find((j) => j.index === f.index)?.ranges
          : undefined
      }
      current={
        place && place.kind === "json" && place.index === f.index
          ? place.local
          : -1
      }
    />
  ));

  if (panel)
    return (
      <div className="rowpanel__body">
        {list}
        {sections}
      </div>
    );
  return (
    <div
      className={`rowdialog__body${json.length === 0 ? " rowdialog__body--plain" : ""}`}
    >
      <div className="rowdialog__fields">
        <div className="rowdialog__fieldshead">
          <span className="section-label">Columns</span>
          <span className="rowdialog__count">
            {searching
              ? `${shown.length} of ${plain.length} match`
              : columns.length}
          </span>
        </div>
        <div className="rowdialog__fieldsbody">{list}</div>
      </div>
      {json.length > 0 && <div className="rowdialog__json">{sections}</div>}
    </div>
  );
}
