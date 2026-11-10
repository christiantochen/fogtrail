import { useCallback, useEffect, useRef, useState } from "react";
import { cancelQuery, runQuery } from "../api/browse";
import { toAppError } from "../api/errors";
import type { AppError, QueryResult } from "../api/types";
import { copyText } from "../lib/clipboard";
import {
  elapsedLabel,
  isNumericType,
  resultToTsv,
  rowCountLabel,
} from "../lib/sql";
import { useUi } from "../state/ui";
import { Lock } from "./Icons";
import { SqlInput } from "./SqlInput";

/** What the last run came to. */
type Outcome =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: QueryResult }
  | { kind: "error"; error: AppError };

/** One line in the Messages tab. */
interface Entry {
  id: number;
  at: Date;
  sql: string;
  ok: boolean;
  text: string;
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const RUN_KEY = MAC ? "⌘↵" : "Ctrl+Enter";
const HISTORY = 30;

/** The first non-blank line of a statement, for the Messages list. */
function firstLine(sql: string): string {
  return (
    sql
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "") ?? ""
  );
}

/** A read-only query editor. Everything it sends is checked by the backend first. */
export function QueryEditor({ schema }: { schema: string | null }) {
  const text = useUi((s) => s.sqlText);
  const setText = useUi((s) => s.setSqlText);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [tab, setTab] = useState<"results" | "messages">("results");
  const [log, setLog] = useState<Entry[]>([]);
  const runId = useRef<string | null>(null);
  const counter = useRef(0);
  const mounted = useRef(true);
  const running = outcome.kind === "running";

  // Leaving the editor stops what it started, so nothing keeps running unseen.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (runId.current) void cancelQuery(runId.current).catch(() => {});
    };
  }, []);

  const remember = useCallback((sql: string, ok: boolean, message: string) => {
    setLog((old) =>
      [
        { id: ++counter.current, at: new Date(), sql, ok, text: message },
        ...old,
      ].slice(0, HISTORY),
    );
  }, []);

  const run = useCallback(async () => {
    const sql = useUi.getState().sqlText;
    if (runId.current || sql.trim() === "") return;
    const id = crypto.randomUUID();
    runId.current = id;
    setOutcome({ kind: "running" });
    setTab("results");
    try {
      const result = await runQuery(sql, schema, id);
      if (!mounted.current) return;
      setOutcome({ kind: "done", result });
      remember(
        sql,
        true,
        `${rowCountLabel(result.rows.length)} in ${elapsedLabel(result.elapsedMs)}` +
          (result.truncated
            ? `, stopped at the ${result.rowLimit} row limit`
            : ""),
      );
    } catch (e) {
      if (!mounted.current) return;
      const error = toAppError(e);
      setOutcome({ kind: "error", error });
      remember(
        sql,
        false,
        error.kind === "blocked" ? `Blocked. ${error.message}` : error.message,
      );
    } finally {
      runId.current = null;
    }
  }, [schema, remember]);

  const stop = () => {
    if (runId.current) void cancelQuery(runId.current).catch(() => {});
  };

  const result = outcome.kind === "done" ? outcome.result : null;

  return (
    <div className="sqltable">
      <div className="detail__head">
        <div>
          <h1 className="detail__name">Query</h1>
          <div className="chips">
            {schema && <span className="chip mono">{schema}</span>}
            <span className="chip chip--icon">
              <Lock width={12} height={12} /> Read-only
            </span>
          </div>
        </div>
        <div className="actions">
          <kbd className="runkey" aria-hidden="true">
            {RUN_KEY}
          </kbd>
          {running && (
            <button type="button" className="btn" onClick={stop}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn btn--primary"
            disabled={running || text.trim() === ""}
            onClick={() => void run()}
          >
            {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>

      <div className="panel sqlpanel">
        <div className="querybar">
          <span>SELECT, SHOW, DESCRIBE, EXPLAIN and WITH only</span>
          <span>Row limit 1,000</span>
          <span>Timeout 30 s</span>
        </div>

        <SqlInput
          value={text}
          onChange={setText}
          onRun={() => void run()}
          schema={schema}
        />

        <div className="panel__bar">
          <div className="tabs" role="tablist" aria-label="Query output">
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === "results"}
              onClick={() => setTab("results")}
            >
              Results
            </button>
            <button
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === "messages"}
              onClick={() => setTab("messages")}
            >
              Messages{log.length > 0 ? ` · ${log.length}` : ""}
            </button>
          </div>
        </div>

        {tab === "messages" ? (
          <Messages log={log} />
        ) : outcome.kind === "idle" ? (
          <div className="queryempty">
            <h2>No results yet</h2>
            <p>
              Run a SELECT to see rows here. Fogtrail is read-only by design.
            </p>
          </div>
        ) : outcome.kind === "running" ? (
          <div className="sqlpanel__body" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div className="skeleton" key={i} />
            ))}
          </div>
        ) : outcome.kind === "error" ? (
          <div className="sqlpanel__body">
            <div role="alert" className="alert alert--block">
              <span>
                {outcome.error.kind === "blocked" && <strong>Blocked. </strong>}
                {outcome.error.message}
              </span>
            </div>
          </div>
        ) : (
          result && <Grid result={result} />
        )}
      </div>
    </div>
  );
}

function Grid({ result }: { result: QueryResult }) {
  const { columns, rows } = result;
  return (
    <>
      <div className="table-wrap sqlwrap">
        {columns.length > 0 && (
          <table className="sqlgrid" aria-label="Query results">
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th
                    key={i}
                    className={isNumericType(c.typeName) ? "num" : undefined}
                  >
                    <span className="sqlgrid__name">{c.name}</span>
                    <span className="sqlgrid__sub mono">
                      {c.typeName.toLowerCase()}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) =>
                    cell === null ? (
                      <td key={i} className="sqlgrid__null">
                        NULL
                      </td>
                    ) : (
                      <td
                        key={i}
                        className={
                          isNumericType(columns[i]?.typeName ?? "")
                            ? "num"
                            : undefined
                        }
                        title={cell}
                      >
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length === 0 && (
          <div className="note">The query returned no rows.</div>
        )}
      </div>
      <div className="sqlfoot">
        <span>
          {rowCountLabel(rows.length)} · {elapsedLabel(result.elapsedMs)}
        </span>
        {result.truncated && (
          <span className="sqlfoot__warn">
            Showing the first {result.rowLimit.toLocaleString("en-US")} rows.
            The query has more.
          </span>
        )}
        <span className="sqlfoot__spacer" />
        <button
          type="button"
          className="btn btn--small"
          disabled={columns.length === 0}
          onClick={() => void copyText(resultToTsv(columns, rows), "results")}
        >
          Copy results
        </button>
      </div>
    </>
  );
}

function Messages({ log }: { log: Entry[] }) {
  if (log.length === 0) {
    return (
      <div className="queryempty">
        <h2>No messages yet</h2>
        <p>What each run did, and any error from the server, shows here.</p>
      </div>
    );
  }
  return (
    <ul className="runlog" aria-label="Messages">
      {log.map((e) => (
        <li key={e.id} className={e.ok ? undefined : "runlog__bad"}>
          <span className="runlog__time mono">
            {e.at.toLocaleTimeString("en-GB")}
          </span>
          <span className="runlog__sql mono" title={e.sql}>
            {firstLine(e.sql)}
          </span>
          <span className="runlog__text">{e.text}</span>
        </li>
      ))}
    </ul>
  );
}
