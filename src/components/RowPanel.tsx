import { useEffect, useRef } from "react";
import type { ResultColumn } from "../api/types";
import { copyText } from "../lib/clipboard";
import { isJsonType, prettyJson } from "../lib/sql";
import { JsonText } from "./JsonText";

/** One row of a table laid out as a list: every column, with JSON shown over lines. */
export function RowPanel({
  table,
  columns,
  row,
  position,
  count,
  onMove,
  onClose,
}: {
  table: string;
  columns: ResultColumn[];
  row: (string | null)[];
  position: number;
  count: number;
  onMove: (delta: number) => void;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);
  // Opening the panel moves focus into it, so Esc and the arrow buttons work at once.
  useEffect(() => close.current?.focus(), []);

  const id = columns.findIndex((c) => c.name === "id");
  const title =
    id >= 0 && row[id] !== null ? `${table} · id ${row[id]}` : table;
  const plain: number[] = [];
  const json: number[] = [];
  columns.forEach((c, i) => {
    if (isJsonType(c.typeName) && row[i] !== null && prettyJson(row[i]!))
      json.push(i);
    else plain.push(i);
  });

  return (
    <aside
      className="rowpanel"
      aria-label="Row details"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="rowpanel__head">
        <div className="rowpanel__title">
          <span className="rowpanel__label">
            Row {position + 1} of {count}
          </span>
          <span className="rowpanel__name mono">{title}</span>
        </div>
        <button
          type="button"
          className="btn btn--small"
          aria-label="Previous row"
          disabled={position === 0}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn btn--small"
          aria-label="Next row"
          disabled={position >= count - 1}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button
          ref={close}
          type="button"
          className="btn btn--small"
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="rowpanel__body">
        <dl className="rowpanel__list">
          {plain.map((i) => (
            <div key={columns[i].name} className="rowpanel__item">
              <dt className="mono">{columns[i].name}</dt>
              {row[i] === null ? (
                <dd className="mono sqlgrid__null">NULL</dd>
              ) : (
                <dd className="mono">{row[i]}</dd>
              )}
            </div>
          ))}
        </dl>
        {json.map((i) => {
          const pretty = prettyJson(row[i]!)!;
          return (
            <section key={columns[i].name} className="rowpanel__json">
              <div className="rowpanel__jsonhead">
                <span className="mono">{columns[i].name}</span>
                <span className="badge mono">json</span>
                <span className="rowpanel__spacer" />
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => void copyText(pretty, columns[i].name)}
                >
                  Copy JSON
                </button>
              </div>
              <JsonText text={pretty} />
            </section>
          );
        })}
      </div>
    </aside>
  );
}
