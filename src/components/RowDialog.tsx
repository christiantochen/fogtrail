import { useEffect, useMemo, useRef, useState } from "react";
import type { ResultColumn } from "../api/types";
import { copyText } from "../lib/clipboard";
import { findRanges, MAX_HITS, stepHit, type Range } from "../lib/find";
import { findInRow, hitsLabel } from "../lib/rowFind";
import { rowTitle, splitRow, type JsonField } from "../lib/sql";
import { useUi } from "../state/ui";
import { FoldAllButton } from "./JsonSection";
import { JsonText } from "./JsonText";
import { ArrowLeftIcon } from "./Icons";
import { RowBody } from "./RowBody";
import { useEscape } from "./useEscape";
import { useJsonFold, useRevealHit } from "./useJsonFold";

const FOCUSABLE =
  "button:not(:disabled), [href], input, [tabindex]:not([tabindex='-1'])";

/**
 * A row in a big dialog over the table: every column in table order, or one JSON value on its
 * own (opened from the list, with a way back). It is for reading; the side panel is for looking
 * at rows one after another while the table stays in view.
 */
export function RowDialog({
  table,
  columns,
  row,
  position,
  count,
  json,
  onMove,
  onJson,
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
  /** Show one JSON value on its own, or null to go back to the whole row. */
  onJson: (column: number | null) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const opened = useRef<number | null>(null);
  const hideNull = useUi((s) => s.hideNull);
  const setHideNull = useUi((s) => s.setHideNull);
  const split = useMemo(() => splitRow(columns, row), [columns, row]);
  const solo =
    json === null ? undefined : split.json.find((f) => f.index === json);

  // Find: kept while moving between rows and between the list and one value.
  const [term, setTerm] = useState("");
  const [at, setAt] = useState(0);
  const search = useRef<HTMLInputElement>(null);
  const hits = useMemo(
    () => findInRow(columns, row, split.json, term),
    [columns, row, split, term],
  );
  // One JSON value on its own is searched for every match inside it.
  const soloRanges = useMemo(
    () => (solo ? findRanges(solo.pretty, term).slice(0, MAX_HITS) : []),
    [solo, term],
  );
  const total = solo ? soloRanges.length : hits.total;
  const current = Math.min(at, Math.max(total - 1, 0));
  // Keep the match the search is on in view.
  useEffect(() => {
    box.current
      ?.querySelector('[data-current="true"]')
      ?.scrollIntoView?.({ block: "center" });
  }, [term, current, position, total, solo]);

  const move = (delta: number) => {
    setAt(0);
    onMove(delta);
  };
  const open = (column: number) => {
    opened.current = column;
    setAt(0);
    onJson(column);
  };
  // Esc steps back: from one value to the row, then closes (see useEscape for focus outside).
  const escape = () => {
    if (solo) {
      setAt(0);
      onJson(null);
    } else onClose();
  };
  useEscape(escape);

  // Up and down move between rows, wherever focus is, except while typing in a text box.
  const keys = useRef({ solo: false, position, count, move });
  useEffect(() => {
    keys.current = { solo: solo !== undefined, position, count, move };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (
        t instanceof HTMLTextAreaElement ||
        t instanceof HTMLSelectElement ||
        (t instanceof HTMLInputElement &&
          !["checkbox", "radio", "button"].includes(t.type)) ||
        (t instanceof HTMLElement && t.isContentEditable)
      )
        return;
      const k = keys.current;
      if (k.solo) return;
      const delta = e.key === "ArrowUp" ? -1 : 1;
      e.preventDefault();
      if (k.position + delta >= 0 && k.position + delta < k.count)
        k.move(delta);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus moves in, and goes back to where it was when the dialog closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
  }, []);
  // Opening one value puts focus on Back; going back puts it on that value's Open button.
  const soloAt = solo?.index;
  useEffect(() => {
    if (soloAt !== undefined) back.current?.focus();
    else if (opened.current !== null) {
      box.current
        ?.querySelector<HTMLElement>(`[data-open="${opened.current}"]`)
        ?.focus();
      opened.current = null;
    }
  }, [soloAt]);

  const label = `Row ${position + 1} of ${count}`;
  const title = rowTitle(table, columns, row);
  const searchBox = (
    <div className="find find--dialog">
      <input
        ref={search}
        type="search"
        className="find__input"
        aria-label={solo ? "Find in value" : "Find in row"}
        placeholder={solo ? "Find in value" : "Find in row"}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && total > 0) {
            e.preventDefault();
            setAt(stepHit(current, total, e.shiftKey));
          } else if (e.key === "Escape" && term !== "") {
            // The first Esc clears the search; a second one steps back or closes.
            e.preventDefault();
            e.stopPropagation();
            setTerm("");
          }
        }}
      />
      {term !== "" && (
        <span className="find__count" role="status">
          {hitsLabel(total, current)}
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
        className="rowdialog"
        role="dialog"
        aria-modal="true"
        aria-label={solo ? columns[solo.index].name : "Row details"}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            escape();
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
            backButton={
              <button
                ref={back}
                type="button"
                className="btn btn--small btn--icon"
                onClick={escape}
              >
                <ArrowLeftIcon /> Back to row
              </button>
            }
            closeButton={closeButton}
            searchBox={searchBox}
            ranges={soloRanges}
            current={term === "" ? -1 : current}
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
                title="Previous row (↑)"
                disabled={position === 0}
                onClick={() => move(-1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn--small"
                aria-label="Next row"
                title="Next row (↓)"
                disabled={position >= count - 1}
                onClick={() => move(1)}
              >
                ↓
              </button>
              {searchBox}
              <label className="rowdialog__check">
                <input
                  type="checkbox"
                  checked={hideNull}
                  onChange={(e) => setHideNull(e.target.checked)}
                />
                Hide null
              </label>
              {closeButton}
            </div>
            <RowBody
              key={position}
              columns={columns}
              row={row}
              variant="dialog"
              onOpenJson={open}
              find={{ term, hits, current }}
              hideNull={hideNull}
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
  backButton,
  closeButton,
  searchBox,
  ranges,
  current,
}: {
  field: JsonField;
  name: string;
  label: string;
  backButton: React.ReactNode;
  closeButton: React.ReactNode;
  searchBox: React.ReactNode;
  ranges: readonly Range[];
  current: number;
}) {
  const fold = useJsonFold(field.pretty, false);
  useRevealHit(fold, field.pretty, ranges, current);
  return (
    <>
      <div className="rowdialog__head">
        {backButton}
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
