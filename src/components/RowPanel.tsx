import { useEffect, useRef } from "react";
import type { ResultColumn } from "../api/types";
import { rowTitle } from "../lib/sql";
import { ExpandIcon } from "./Icons";
import { RowBody } from "./RowBody";
import { useEscape } from "./useEscape";

/** One row of a table laid out as a list: every column, with JSON folded one level. */
export function RowPanel({
  table,
  columns,
  row,
  position,
  count,
  onMove,
  onClose,
  onExpand,
}: {
  table: string;
  columns: ResultColumn[];
  row: (string | null)[];
  position: number;
  count: number;
  onMove: (delta: number) => void;
  onClose: () => void;
  /** Open the dialog: on the whole row, or on one column's JSON. */
  onExpand: (column: number | null) => void;
}) {
  // Esc with focus elsewhere must not leave full screen on macOS.
  useEscape();
  const close = useRef<HTMLButtonElement>(null);
  // Opening the panel moves focus into it, so Esc and the arrow buttons work at once.
  useEffect(() => close.current?.focus(), []);

  return (
    <aside
      className="rowpanel"
      aria-label="Row details"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onExpand(null);
        }
      }}
    >
      <div className="rowpanel__head">
        <div className="rowpanel__title">
          <span className="rowpanel__label">
            Row {position + 1} of {count}
          </span>
          <span className="rowpanel__name mono">
            {rowTitle(table, columns, row)}
          </span>
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
          type="button"
          className="btn btn--small btn--icon"
          aria-label="Expand row in a dialog"
          title="Expand (E)"
          onClick={() => onExpand(null)}
        >
          <ExpandIcon />
          Expand
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
      <RowBody
        key={position}
        columns={columns}
        row={row}
        variant="panel"
        onExpand={onExpand}
      />
    </aside>
  );
}
