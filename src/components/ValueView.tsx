import { useEffect, useMemo, useRef, useState } from "react";
import type { Value } from "../api/types";
import { hexDump, tryPrettyJson } from "../lib/format";
import {
  FIND_VALUE_EVENT,
  MAX_HITS,
  findRanges,
  stepHit,
  type Range,
} from "../lib/find";
import { freshEntries } from "../lib/refresh";
import { collapseAll, lineAt, parseBlocks, unfoldFor } from "../lib/fold";
import { COLOR_LIMIT, JsonText, type Folding } from "./JsonText";
import { Marked } from "./Marked";
import { StreamView } from "./StreamView";

type Mode = "pretty" | "raw" | "table" | "list" | "json" | "hex" | "entries";
const LABEL: Record<Mode, string> = {
  pretty: "Pretty",
  raw: "Raw",
  table: "Table",
  list: "List",
  json: "JSON",
  hex: "Hex",
  entries: "Entries",
};

/** The views that make sense for a value, first one is the default. */
export function modesFor(value: Value): Mode[] {
  switch (value.type) {
    case "text":
      return tryPrettyJson(value.text) ? ["pretty", "raw"] : ["raw"];
    case "binary":
      return ["hex"];
    case "map":
    case "table":
      return ["table", "json"];
    case "list":
      return ["list", "json"];
    case "stream":
      return ["entries", "json"];
    case "unsupported":
      return [];
  }
}

/** Plain text of the value, for the "Copy value" button. */
export function valueAsText(value: Value): string {
  switch (value.type) {
    case "text":
      return value.text;
    case "binary":
      return value.hex;
    case "map":
      return JSON.stringify(
        Object.fromEntries(value.entries.map((e) => [e.key, e.value])),
        null,
        2,
      );
    case "list":
      return JSON.stringify(value.items, null, 2);
    case "table":
      return JSON.stringify(value.rows, null, 2);
    case "stream":
      return JSON.stringify(
        value.entries.map((e) => ({
          id: e.id,
          ...Object.fromEntries(e.fields.map((f) => [f.key, f.value])),
        })),
        null,
        2,
      );
    case "unsupported":
      return "";
  }
}

/** The text the value is shown as: pretty-printed when it is JSON. */
function shownText(value: Value): string {
  return value.type === "text"
    ? (tryPrettyJson(value.text) ?? value.text)
    : valueAsText(value);
}

/** The text a find box searches in this view, or null for table-like and hex views. */
function searchableText(value: Value, mode: Mode): string | null {
  if (mode === "hex" || mode === "entries") return null;
  if (mode === "json") return valueAsText(value);
  if (value.type === "text")
    return mode === "pretty"
      ? (tryPrettyJson(value.text) ?? value.text)
      : value.text;
  return null;
}

/** Rows of a table-like value, or null when the view isn't one. */
function gridOf(
  value: Value,
  mode: Mode,
): { head: string[]; rows: string[][] } | null {
  if (mode === "json" || mode === "hex" || mode === "entries") return null;
  if (value.type === "map")
    return {
      head: ["Field", "Value"],
      rows: value.entries.map((e) => [e.key, e.value]),
    };
  if (value.type === "list")
    return {
      head: ["#", "Value"],
      rows: value.items.map((v, i) => [String(i), v]),
    };
  if (value.type === "table") return { head: value.columns, rows: value.rows };
  return null;
}

function truncation(value: Value): string | null {
  if (
    value.type === "unsupported" ||
    value.type === "stream" ||
    !value.truncated
  )
    return null;
  if (value.type === "text") return "Showing the first 1 MB.";
  if (value.type === "binary")
    return `Showing the first 4 KB of ${value.length} bytes.`;
  return `Showing the first ${value.type === "list" ? value.items.length : value.type === "map" ? value.entries.length : value.rows.length} of ${value.total}.`;
}

export function ValueView({ value, name }: { value: Value; name: string }) {
  const modes = modesFor(value);
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode = picked && modes.includes(picked) ? picked : modes[0];

  // Find in value: highlights text views, filters rows of table-like views.
  const [term, setTerm] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const text = searchableText(value, mode);
  const grid = gridOf(value, mode);
  const ranges = useMemo<Range[]>(
    () => (text === null ? [] : findRanges(text, term)),
    [text, term],
  );
  const rows = useMemo(() => {
    if (!grid || term === "") return null;
    const needle = term.toLowerCase();
    return grid.rows.filter((r) =>
      r.some((c) => c.toLowerCase().includes(needle)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mode, term]);
  const current = Math.min(at, Math.max(ranges.length - 1, 0));
  const canFind = text !== null || grid !== null;

  // What changed since the last read, so a refresh can flash it. A new key remounts, so starts clean.
  const [last, setLast] = useState<{
    value: Value;
    pulse: number;
    lines: ReadonlySet<string>;
    rows: ReadonlySet<string>;
  }>({ value, pulse: 0, lines: new Set(), rows: new Set() });
  if (last.value !== value) {
    const rowsOf = (v: Value) =>
      (gridOf(v, "table")?.rows ?? []).map((r) => r.join("\u0000"));
    setLast({
      value,
      pulse: last.pulse + 1,
      lines: freshEntries(
        shownText(last.value).split("\n"),
        shownText(value).split("\n"),
      ),
      rows: freshEntries(rowsOf(last.value), rowsOf(value)),
    });
  }
  const fresh = { pulse: last.pulse, lines: last.lines, rows: last.rows };

  // Folding: JSON views only, and only while the text is small enough to color.
  const foldText =
    text !== null &&
    text.length <= COLOR_LIMIT &&
    (mode === "json" || mode === "pretty")
      ? text
      : null;
  const blocks = useMemo(
    () => (foldText === null ? [] : parseBlocks(foldText)),
    [foldText],
  );
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());
  // A new text starts expanded; a find hit hidden inside a fold opens it.
  const hit = ranges[current]?.[0] ?? -1;
  const [seen, setSeen] = useState<{ text: string | null; hit: number }>({
    text: foldText,
    hit: -1,
  });
  if (seen.text !== foldText || seen.hit !== hit) {
    setSeen({ text: foldText, hit });
    setFolded(
      seen.text !== foldText || foldText === null || hit < 0
        ? new Set()
        : unfoldFor(folded, blocks, lineAt(foldText, hit)),
    );
  }
  const folding: Folding | undefined =
    foldText === null
      ? undefined
      : {
          blocks,
          folded,
          onToggle: (line) =>
            setFolded((f) => {
              const next = new Set(f);
              if (!next.delete(line)) next.add(line);
              return next;
            }),
        };

  useEffect(() => {
    const focus = () => box.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        focus();
      }
    };
    window.addEventListener(FIND_VALUE_EVENT, focus);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener(FIND_VALUE_EVENT, focus);
      window.removeEventListener("keydown", key);
    };
  }, []);

  // Keep the match the user is on in view.
  useEffect(() => {
    panel.current
      ?.querySelector('mark[data-current="true"]')
      ?.scrollIntoView({ block: "center" });
  }, [current, term, mode]);

  if (value.type === "unsupported") {
    return (
      <div className="panel">
        <p className="note">
          Fogtrail can’t show <b>{value.kind}</b> values yet.
        </p>
      </div>
    );
  }

  const note = truncation(value);
  const hits =
    ranges.length >= MAX_HITS ? `${MAX_HITS}+` : String(ranges.length);
  const count =
    term === ""
      ? null
      : rows
        ? `${rows.length} of ${grid?.rows.length} rows`
        : text !== null
          ? ranges.length === 0
            ? "No matches"
            : `${current + 1} of ${hits}`
          : null;
  return (
    <div className="panel" ref={panel}>
      <div className="panel__bar">
        <div className="tabs" role="tablist" aria-label="View as">
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              className="tab"
              aria-selected={m === mode}
              onClick={() => setPicked(m)}
            >
              {LABEL[m]}
            </button>
          ))}
        </div>
        {foldText !== null && blocks.length > 1 && (
          <div className="folds">
            <button
              type="button"
              className="btn btn--small"
              onClick={() => setFolded(collapseAll(blocks))}
            >
              Collapse all
            </button>
            <button
              type="button"
              className="btn btn--small"
              onClick={() => setFolded(new Set())}
            >
              Expand all
            </button>
          </div>
        )}
        {note && <span className="panel__note">{note}</span>}
        {canFind && (
          <div className="find">
            <input
              ref={box}
              type="search"
              className="find__input"
              aria-label="Find in value"
              placeholder="Find in value"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setAt(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ranges.length > 0) {
                  e.preventDefault();
                  setAt(stepHit(current, ranges.length, e.shiftKey));
                } else if (e.key === "Escape") {
                  setTerm("");
                  e.currentTarget.blur();
                }
              }}
            />
            {count && (
              <span className="find__count" role="status">
                {count}
              </span>
            )}
          </div>
        )}
      </div>
      <Body
        value={value}
        mode={mode}
        name={name}
        text={text}
        ranges={ranges}
        current={current}
        term={term}
        rows={rows}
        folding={folding}
        fresh={fresh}
      />
    </div>
  );
}

function Body({
  value,
  mode,
  name,
  text,
  ranges,
  current,
  term,
  rows,
  folding,
  fresh,
}: {
  value: Value;
  mode: Mode;
  name: string;
  text: string | null;
  ranges: Range[];
  current: number;
  term: string;
  rows: string[][] | null;
  folding: Folding | undefined;
  fresh: Fresh;
}) {
  if (mode === "entries" && value.type === "stream") {
    return (
      <StreamView
        name={name}
        first={value.entries}
        firstBefore={value.nextBefore}
        total={value.total}
        groups={value.groups}
      />
    );
  }
  if (mode === "hex" && value.type === "binary") {
    return <pre className="code code--hex">{hexDump(value.hex)}</pre>;
  }
  if (mode === "json" && text !== null)
    return (
      <JsonText
        text={text}
        ranges={ranges}
        current={current}
        folding={folding}
        fresh={fresh}
      />
    );
  if (value.type === "text" && text !== null) {
    return mode === "pretty" && tryPrettyJson(value.text) ? (
      <JsonText
        text={text}
        ranges={ranges}
        current={current}
        folding={folding}
        fresh={fresh}
      />
    ) : (
      <pre className="code">
        <Marked text={text} ranges={ranges} current={current} />
      </pre>
    );
  }
  if (value.type === "map") {
    return (
      <Grid
        head={["Field", "Value"]}
        rows={rows ?? value.entries.map((e) => [e.key, e.value])}
        term={term}
        fresh={fresh}
      />
    );
  }
  if (value.type === "list") {
    return (
      <Grid
        head={["#", "Value"]}
        rows={rows ?? value.items.map((v, i) => [String(i), v])}
        term={term}
        fresh={fresh}
      />
    );
  }
  if (value.type === "table")
    return (
      <Grid
        head={value.columns}
        rows={rows ?? value.rows}
        term={term}
        fresh={fresh}
      />
    );
  return null;
}

/** What changed in the latest read; `pulse` counts reads so the flash restarts each time. */
export interface Fresh {
  pulse: number;
  lines: ReadonlySet<string>;
  rows: ReadonlySet<string>;
}

function Grid({
  head,
  rows,
  term,
  fresh,
}: {
  head: string[];
  rows: string[][];
  term: string;
  fresh: Fresh;
}) {
  return (
    <div className="table-wrap">
      <table className="grid">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${i}:${fresh.rows.has(r.join("\u0000")) ? fresh.pulse : 0}`}
              className={
                fresh.rows.has(r.join("\u0000")) ? "row--fresh" : undefined
              }
            >
              {r.map((c, j) => (
                <td key={j}>
                  <Marked text={c} ranges={findRanges(c, term)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
