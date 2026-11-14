import {
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCompletionKnown } from "../api/queries";
import { lineCount, sqlDialectOf, type SqlDialect } from "../lib/sql";
import { useUi } from "../state/ui";
import { type Item, contextAt, suggest } from "../lib/sqlComplete";
import {
  HIGHLIGHT_LIMIT,
  type Token,
  tokenClass,
  tokenize,
} from "../lib/sqlHighlight";

const LINE = 20;
const PAD_X = 12;
const PAD_Y = 10;
const GUTTER = 44;
const POPUP_WIDTH = 280;
const TAG: Record<Item["kind"], string> = {
  keyword: "kw",
  function: "fn",
  table: "tbl",
  view: "view",
  column: "col",
  database: "db",
};

/** The text with its colours, drawn behind the transparent textarea. */
function Coloured({ text, dialect }: { text: string; dialect: SqlDialect }) {
  const parts = useMemo(() => {
    if (text.length > HIGHLIGHT_LIMIT) return [text];
    return tokenize(text, dialect).map((t: Token, i) => {
      const cls = tokenClass(text, t);
      const s = text.slice(t.start, t.end);
      return cls ? (
        <span key={i} className={cls}>
          {s}
        </span>
      ) : (
        s
      );
    });
  }, [text, dialect]);
  // The extra line break keeps a last empty line as tall as the textarea draws it.
  return (
    <>
      {parts}
      {"\n"}
    </>
  );
}

/** Where the caret is, in pixels inside the text area, for placing the list. */
function caretPoint(text: string, caret: number, charWidth: number) {
  const before = text.slice(0, caret);
  const lines = before.split("\n");
  let col = 0;
  for (const ch of lines[lines.length - 1]) {
    // A tab moves to the next multiple of eight, like the textarea draws it.
    col = ch === "\t" ? (Math.floor(col / 8) + 1) * 8 : col + 1;
  }
  return { x: col * charWidth, y: (lines.length - 1) * LINE };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  schema: string | null;
}

/** The SQL box: line numbers, colours, and a list of suggestions at the caret. */
export function SqlInput({ value, onChange, onRun, schema }: Props) {
  const listId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const lines = useRef<HTMLDivElement>(null);
  const colours = useRef<HTMLPreElement>(null);
  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [active, setActive] = useState(0);
  // Enter only takes a suggestion once you have moved in the list; until then it adds a line.
  const [moved, setMoved] = useState(false);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [charWidth, setCharWidth] = useState(7.8);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // Set while a suggestion is being inserted, so the insert doesn't open the list again.
  const inserting = useRef(false);

  const dialect = sqlDialectOf(useUi((s) => s.connected?.driver));
  const ctx = useMemo(
    () => contextAt(value, caret, dialect),
    [value, caret, dialect],
  );
  const known = useCompletionKnown(schema, ctx.refs, ctx.qualifier);
  const items = useMemo(
    () => (open ? suggest(ctx, known, manual) : []),
    [open, ctx, known, manual],
  );
  const shown = items.length > 0;
  const current = Math.min(active, Math.max(0, items.length - 1));

  useLayoutEffect(() => {
    const w = probe.current?.getBoundingClientRect().width;
    if (w) setCharWidth(w / 20);
    const el = wrap.current;
    if (!el) return;
    // The box can be resized by hand, so keep its size up to date.
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The numbers and the colours scroll with the text.
  useEffect(() => {
    if (lines.current)
      lines.current.style.transform = `translateY(${-scroll.top}px)`;
    if (colours.current)
      colours.current.style.transform = `translate(${-scroll.left}px, ${-scroll.top}px)`;
  }, [scroll]);

  const accept = (item: Item) => {
    const el = area.current;
    if (!el) return;
    inserting.current = true;
    el.focus();
    el.setSelectionRange(ctx.start, caret);
    // execCommand keeps the browser's own undo working. If it refuses, edit the value directly.
    if (!document.execCommand("insertText", false, item.insert)) {
      el.setRangeText(item.insert, ctx.start, caret, "end");
      onChange(el.value);
      setCaret(el.selectionStart);
      inserting.current = false;
    }
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onRun();
      return;
    }
    if (e.ctrlKey && e.key === " ") {
      e.preventDefault();
      setCaret(e.currentTarget.selectionStart);
      setManual(true);
      setOpen(true);
      setActive(0);
      setMoved(false);
      return;
    }
    if (!shown) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + items.length) % items.length);
      setMoved(true);
    } else if (e.key === "Tab" || (e.key === "Enter" && moved)) {
      if (e.shiftKey || e.altKey) return;
      e.preventDefault();
      accept(items[current]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  // The list sits under the caret, kept inside the box sideways and hidden when the caret scrolls away.
  const point = caretPoint(value, caret, charWidth);
  const boxWidth = box.w;
  const boxHeight = box.h;
  const left = Math.max(
    GUTTER,
    Math.min(
      GUTTER + PAD_X + point.x - scroll.left,
      Math.max(GUTTER, boxWidth - POPUP_WIDTH - 8),
    ),
  );
  const top = PAD_Y + point.y + LINE - scroll.top;
  const visible = top > 0 && top < boxHeight + LINE;

  return (
    <div className="editorwrap" ref={wrap}>
      <div className="editor">
        <div className="editor__gutter" aria-hidden="true">
          <div ref={lines} className="editor__lines mono">
            {Array.from({ length: lineCount(value) }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        </div>
        <div className="editor__pane">
          <span ref={probe} className="editor__probe mono" aria-hidden="true">
            {"0".repeat(20)}
          </span>
          <pre ref={colours} className="editor__hl mono" aria-hidden="true">
            <Coloured text={value} dialect={dialect} />
          </pre>
          <textarea
            ref={area}
            className="editor__text mono"
            aria-label="SQL"
            aria-autocomplete="list"
            aria-controls={shown ? listId : undefined}
            aria-activedescendant={shown ? `${listId}-${current}` : undefined}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="SELECT * FROM orders LIMIT 10"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setCaret(e.target.selectionStart);
              setManual(false);
              setActive(0);
              setMoved(false);
              const deleting = (
                e.nativeEvent as InputEvent
              ).inputType?.startsWith("delete");
              setOpen(!inserting.current && !deleting);
              inserting.current = false;
            }}
            onScroll={(e) =>
              setScroll({
                left: e.currentTarget.scrollLeft,
                top: e.currentTarget.scrollTop,
              })
            }
            onKeyDown={onKeyDown}
            // Moving the caret by hand closes the list; typing opens it again.
            onKeyUp={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                setCaret(e.currentTarget.selectionStart);
                setOpen(false);
              }
            }}
            onClick={(e) => {
              setCaret(e.currentTarget.selectionStart);
              setOpen(false);
            }}
            onBlur={() => setOpen(false)}
          />
        </div>
      </div>
      {shown && visible && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="complete"
          style={{ left, top, width: POPUP_WIDTH }}
        >
          {items.map((it, i) => (
            <li
              key={`${it.kind}:${it.label}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              className="complete__row"
              // Keeps the focus in the text box while a row is clicked.
              onMouseDown={(e) => {
                e.preventDefault();
                accept(it);
              }}
            >
              <span className={`complete__tag complete__tag--${it.kind}`}>
                {TAG[it.kind]}
              </span>
              <span className="complete__label mono">{it.label}</span>
              {it.detail && (
                <span className="complete__detail mono">{it.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
