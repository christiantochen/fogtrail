import { useEffect, useMemo, useRef, useState } from "react";
import type { ResultColumn } from "../api/types";
import { copyText } from "../lib/clipboard";
import { stepHit, type Range } from "../lib/find";
import { findInRow, hitsLabel, placeOf } from "../lib/rowFind";
import { rowTitle, splitRow, type JsonField } from "../lib/sql";
import { FoldAllButton } from "./JsonSection";
import { JsonText } from "./JsonText";
import { RowBody } from "./RowBody";
import { useEscape } from "./useEscape";
import { useJsonFold, useRevealHit } from "./useJsonFold";

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
  // Esc closes the dialog wherever focus is, not only inside it (see useEscape).
  useEscape(onClose);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const split = useMemo(() => splitRow(columns, row), [columns, row]);
  const solo =
    json === null ? undefined : split.json.find((f) => f.index === json);

  // Find: kept while moving between rows, so one column can be compared across rows.
  const [term, setTerm] = useState("");
  const [at, setAt] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const hits = useMemo(
    () =>
      solo
        ? findInRow(columns, row, [], [solo], term)
        : findInRow(columns, row, split.plain, split.json, term),
    [columns, row, split, solo, term],
  );
  const current = Math.min(at, Math.max(hits.total - 1, 0));
  const place = placeOf(hits, current);
  // Keep the match the search is on in view.
  useEffect(() => {
    box.current
      ?.querySelector('mark[data-current="true"]')
      ?.scrollIntoView?.({ block: "center" });
  }, [term, current, position, hits.total]);
  const move = (delta: number) => {
    setAt(0);
    onMove(delta);
  };

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
  const searchBox = (
    <div className="find find--dialog">
      <input
        ref={search}
        type="search"
        className="find__input"
        aria-label="Find in row"
        placeholder="Find in row"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hits.total > 0) {
            e.preventDefault();
            setAt(stepHit(current, hits.total, e.shiftKey));
          } else if (e.key === "Escape" && term !== "") {
            // The first Esc clears the search; a second one closes the dialog.
            e.preventDefault();
            e.stopPropagation();
            setTerm("");
          }
        }}
      />
      {term !== "" && (
        <span className="find__count" role="status">
          {hitsLabel(hits.total, current)}
        </span>
      )}
    </div>
  );
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
          } else if (
            (e.metaKey || e.ctrlKey) &&
            !e.shiftKey &&
            e.key.toLowerCase() === "f"
          ) {
            e.preventDefault();
            search.current?.focus();
            search.current?.select();
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
            searchBox={searchBox}
            ranges={hits.json[0]?.ranges}
            current={place?.kind === "json" ? place.local : -1}
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
                onClick={() => move(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn--small"
                aria-label="Next row"
                disabled={position >= count - 1}
                onClick={() => move(1)}
              >
                ↓
              </button>
              {searchBox}
              {closeButton}
            </div>
            <RowBody
              key={position}
              columns={columns}
              row={row}
              variant="dialog"
              find={{ term, hits, current }}
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
  searchBox,
  ranges = [],
  current,
}: {
  field: JsonField;
  name: string;
  label: string;
  closeButton: React.ReactNode;
  searchBox: React.ReactNode;
  ranges?: readonly Range[];
  current: number;
}) {
  const fold = useJsonFold(field.pretty, false);
  useRevealHit(fold, field.pretty, ranges, current);
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
        {searchBox}
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
        <JsonText
          text={field.pretty}
          ranges={ranges}
          current={current}
          folding={fold.folding}
        />
      </div>
    </>
  );
}
