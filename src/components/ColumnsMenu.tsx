import { useEffect, useId, useRef, useState } from "react";
import { canHide, matchColumns, toggleHidden } from "../lib/hiddenColumns";
import { Check } from "./Icons";

/**
 * The Columns button above a table and the list it opens: a tick for every column, a search box,
 * Show all. Hiding is only about what is on screen and copied; the rows are read in full either
 * way. A pinned column stays until it is unpinned, and the last column showing cannot be hidden.
 */
export function ColumnsMenu({
  columns,
  hidden,
  pinned,
  onChange,
}: {
  /** Every column of the table, in table order, with its type for the quiet text. */
  columns: readonly { name: string; sub: string }[];
  hidden: readonly string[];
  /** Pinned column names. */
  pinned: readonly string[];
  onChange: (hidden: string[]) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const names = columns.map((c) => c.name);
  const shown = names.length - hidden.length;
  const listed = matchColumns(columns, term);

  const close = () => {
    setOpen(false);
    setTerm("");
  };

  // Clicking away closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  return (
    <div
      className="colmenu"
      ref={root}
      onKeyDown={(e) => {
        // Only this list closes, not whatever is behind it.
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          close();
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={`btn btn--icon${hidden.length > 0 ? " btn--attention" : ""}`}
        aria-expanded={open}
        aria-controls={open ? `${id}-panel` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Columns
        {hidden.length > 0 && (
          <span className="colmenu__count mono">
            {shown}/{names.length}
          </span>
        )}
      </button>
      {open && (
        <div
          id={`${id}-panel`}
          className="colmenu__panel"
          role="group"
          aria-label="Columns"
        >
          <input
            ref={search}
            className="colmenu__search"
            type="search"
            aria-label="Find a column"
            placeholder="Find a column"
            spellCheck={false}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            // This sits inside the filter form: Enter must not apply the filter.
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
          />
          <ul className="colmenu__list">
            {listed.map((c) => {
              const on = !hidden.includes(c.name);
              const allowed = canHide(names, hidden, pinned, c.name);
              const why = pinned.includes(c.name)
                ? "Pinned. Unpin it to hide it."
                : !allowed
                  ? "The last column showing stays."
                  : undefined;
              return (
                <li key={c.name}>
                  <label
                    className={`colmenu__item${allowed ? "" : " colmenu__item--off"}`}
                    title={why}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      disabled={!allowed}
                      aria-describedby={why ? `${id}-why-${c.name}` : undefined}
                      onChange={() => onChange(toggleHidden(hidden, c.name))}
                    />
                    <span
                      className={`colmenu__box${on ? " colmenu__box--on" : ""}`}
                      aria-hidden="true"
                    >
                      {on && <Check width={11} height={11} />}
                    </span>
                    <span className="colmenu__name mono">{c.name}</span>
                    <span className="colmenu__sub mono">{c.sub}</span>
                    {why && (
                      <span id={`${id}-why-${c.name}`} className="sr-only">
                        {why}
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
            {listed.length === 0 && (
              <li className="colmenu__none">No column matches.</li>
            )}
          </ul>
          <div className="colmenu__foot">
            <span className="muted">
              {shown} of {names.length} showing
            </span>
            <button
              type="button"
              className="btn btn--small"
              disabled={hidden.length === 0}
              onClick={() => onChange([])}
            >
              Show all
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
