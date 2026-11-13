import { useRef, useState } from "react";
import { CloseIcon, Refresh } from "./Icons";
import { tokenClass, tokenize, HIGHLIGHT_LIMIT } from "../lib/sqlHighlight";

/**
 * The WHERE filter above a table's rows: one line of SQL, coloured as it is typed.
 * The text is only a condition. The backend puts it into a SELECT and checks the
 * whole statement before anything is sent.
 */
export function FilterBar({
  applied,
  onApply,
  onRefresh,
  refreshing,
}: {
  applied: string;
  onApply: (filter: string) => void;
  /** Reload the table, used by the button while the filter has nothing new to apply. */
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [draft, setDraft] = useState(applied);
  const colors = useRef<HTMLPreElement>(null);
  const changed = draft.trim() !== applied.trim();

  const apply = (text: string) => onApply(text.trim());
  const clear = () => {
    setDraft("");
    apply("");
  };
  const sync = (el: HTMLInputElement) => {
    if (colors.current) colors.current.scrollLeft = el.scrollLeft;
  };

  return (
    <form
      className="filterbar"
      onSubmit={(e) => {
        e.preventDefault();
        apply(draft);
      }}
    >
      <div className="filterbar__row">
        <div className="filterbar__box">
          <span className="filterbar__where mono" aria-hidden="true">
            WHERE
          </span>
          <div className="filterbar__field">
            <pre
              ref={colors}
              className="filterbar__colors mono"
              aria-hidden="true"
            >
              {draft.length > HIGHLIGHT_LIMIT ? (
                draft
              ) : (
                <Colored text={draft} />
              )}
              {"\n"}
            </pre>
            <input
              className="filterbar__input mono"
              aria-label="WHERE filter"
              placeholder="status = 'paid' AND total > 100"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                sync(e.target);
              }}
              onScroll={(e) => sync(e.currentTarget)}
              onKeyUp={(e) => sync(e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && draft !== "") {
                  e.preventDefault();
                  clear();
                }
              }}
            />
          </div>
          {draft !== "" && (
            <button
              type="button"
              className="filterbar__clear"
              aria-label="Clear filter"
              title="Clear filter (Esc)"
              onClick={clear}
            >
              <CloseIcon />
            </button>
          )}
        </div>
        {changed ? (
          <button type="submit" className="btn btn--primary">
            Apply <kbd className="filterbar__kbd">↵</kbd>
          </button>
        ) : (
          <button type="button" className="btn btn--icon" onClick={onRefresh}>
            <Refresh className={refreshing ? "spin" : undefined} /> Refresh
          </button>
        )}
      </div>
    </form>
  );
}

function Colored({ text }: { text: string }) {
  return (
    <>
      {tokenize(text).map((t, i) => {
        const cls = tokenClass(text, t);
        const piece = text.slice(t.start, t.end);
        return cls ? (
          <span key={i} className={cls}>
            {piece}
          </span>
        ) : (
          piece
        );
      })}
    </>
  );
}
