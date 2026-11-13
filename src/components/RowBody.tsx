import { useMemo } from "react";
import type { ResultColumn } from "../api/types";
import { splitRow } from "../lib/sql";
import { JsonSection } from "./JsonSection";

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
}: {
  columns: ResultColumn[];
  row: (string | null)[];
  variant: "panel" | "dialog";
  /** Panel only: open the dialog on this column's JSON. */
  onExpand?: (column: number) => void;
}) {
  const { plain, json } = useMemo(() => splitRow(columns, row), [columns, row]);
  const panel = variant === "panel";

  const list = (
    <dl className="rowfields">
      {plain.map((i) => (
        <div key={columns[i].name} className="rowfields__item">
          <dt className="mono">{columns[i].name}</dt>
          {row[i] === null ? (
            <dd className="mono sqlgrid__null">NULL</dd>
          ) : (
            <dd className="mono">{row[i]}</dd>
          )}
        </div>
      ))}
    </dl>
  );
  const sections = json.map((f) => (
    <JsonSection
      key={f.index}
      name={columns[f.index].name}
      field={f}
      startFolded={panel}
      onExpand={panel && onExpand ? () => onExpand(f.index) : undefined}
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
        <div className="section-label">Columns</div>
        {list}
      </div>
      {json.length > 0 && <div className="rowdialog__json">{sections}</div>}
    </div>
  );
}
