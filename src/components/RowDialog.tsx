import { useEffect, useMemo, useRef } from "react";
import type { ResultColumn } from "../api/types";
import { copyText } from "../lib/clipboard";
import { rowTitle, splitRow, type JsonField } from "../lib/sql";
import { FoldAllButton } from "./JsonSection";
import { JsonText } from "./JsonText";
import { RowBody } from "./RowBody";
import { useJsonFold } from "./useJsonFold";

const FOCUSABLE =
  "button:not(:disabled), [href], input, [tabindex]:not([tabindex='-1'])";

/**
 * A row in a big dialog over the table: all of its columns, or just one JSON value. It is for
 * reading; the side panel is for looking at rows one after another while the table stays in view.
 */
export function RowDialog({
  table,
  columns,
  row,
  position,
  count,
  json,
  onMove,
  onClose,
}: {
  table: string;
  columns: ResultColumn[];
  row: (string | null)[];
  position: number;
  count: number;
  /** Index of the JSON column to show alone, or null for the whole row. */
  json: number | null;
  onMove: (delta: number) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const solo = useMemo(
    () =>
      json === null
        ? undefined
        : splitRow(columns, row).json.find((f) => f.index === json),
    [columns, row, json],
  );

  // Focus moves in, and goes back to where it was when the dialog closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);

  const label = `Row ${position + 1} of ${count}`;
  const title = rowTitle(table, columns, row);
  const closeButton = (
    <button
      ref={close}
      type="button"
      className="btn btn--small"
      onClick={onClose}
    >
      Close <kbd className="rowdialog__kbd">Esc</kbd>
    </button>
  );

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className={`rowdialog${solo ? " rowdialog--solo" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={solo ? columns[solo.index].name : "Row details"}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (e.key === "Tab" && box.current) {
            // Tab stays inside the dialog.
            const items = [
              ...box.current.querySelectorAll<HTMLElement>(FOCUSABLE),
            ];
            const first = items[0];
            const last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        {solo ? (
          <SoloJson
            field={solo}
            name={columns[solo.index].name}
            label={`${title} · ${label}`}
            closeButton={closeButton}
          />
        ) : (
          <>
            <div className="rowdialog__head">
              <div className="rowpanel__title">
                <span className="rowpanel__label">{label}</span>
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
              {closeButton}
            </div>
            <RowBody
              key={position}
              columns={columns}
              row={row}
              variant="dialog"
            />
          </>
        )}
      </div>
    </div>
  );
}

/** One JSON value on its own, with everything open to start with. */
function SoloJson({
  field,
  name,
  label,
  closeButton,
}: {
  field: JsonField;
  name: string;
  label: string;
  closeButton: React.ReactNode;
}) {
  const fold = useJsonFold(field.pretty, false);
  return (
    <>
      <div className="rowdialog__head">
        <div className="rowpanel__title">
          <span className="rowpanel__label">{label}</span>
          <span className="rowdialog__solotitle">
            <span className="rowpanel__name mono">{name}</span>
            <span className="badge mono">
              {field.source === "json" ? "json" : "text"}
            </span>
            {field.source === "text" && (
              <span className="badge mono">json detected</span>
            )}
          </span>
        </div>
        <FoldAllButton fold={fold} labeled />
        <button
          type="button"
          className="btn btn--small"
          onClick={() => void copyText(field.pretty, name)}
        >
          Copy JSON
        </button>
        {closeButton}
      </div>
      <div className="rowdialog__solo">
        <JsonText text={field.pretty} folding={fold.folding} />
      </div>
    </>
  );
}
