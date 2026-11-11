import { useRef, useState } from "react";
import { tokenClass, tokenize, HIGHLIGHT_LIMIT } from "../lib/sqlHighlight";

/**
 * The WHERE filter above a table's rows: one line of SQL, coloured as it is typed.
 * The text is only a condition. The backend puts it into a SELECT and checks the
 * whole statement before anything is sent.
 */
export function FilterBar({
  applied,
  onApply,
}: {
  applied: string;
  onApply: (filter: string) => void;
}) {
  const [draft, setDraft] = useState(applied);
  const colors = useRef<HTMLPreElement>(null);
  const changed = draft.trim() !== applied.trim();

  const apply = (text: string) => onApply(text.trim());
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
            />
          </div>
        </div>
        <button
          type="button"
          className="btn"
          disabled={draft === "" && applied === ""}
          onClick={() => {
            setDraft("");
            apply("");
          }}
        >
          Clear
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          disabled={!changed && applied !== ""}
        >
          Apply <kbd className="filterbar__kbd">↵</kbd>
        </button>
      </div>
      <p className="filterbar__hint mono">
        {applied === ""
          ? "A condition, as you would write it after WHERE. Read-only, checked like the query editor."
          : `Showing rows WHERE (${applied}) · read-only, checked like the query editor`}
      </p>
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
