import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useKeys } from "../api/queries";
import { useUi } from "../state/ui";
import { ConnectionSwitch } from "./ConnectionSwitch";
import { DatabaseSelect } from "./DatabaseSelect";
import { KeyTree } from "./KeyTree";
import { Pinned } from "./Pinned";
import { Chevron, Lock, Mark, Refresh } from "./Icons";
import { globFor } from "../lib/tree";
import { copyText } from "../lib/clipboard";
import { useDebounced } from "../lib/useDebounced";
import { formatAgo } from "../lib/refresh";
import { refreshAll } from "../lib/refreshAll";
import { useNow } from "../lib/useNow";

export function Sidebar() {
  const conn = useUi((s) => s.connected);
  const openConnections = useUi((s) => s.openConnections);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const filter = useUi((s) => s.filter);
  const setFilter = useUi((s) => s.setFilter);
  const delimiter = useUi((s) => s.delimiter);
  const setDelimiter = useUi((s) => s.setDelimiter);
  // Searching asks the server (SCAN MATCH), so it finds keys beyond the loaded pages.
  const term = useDebounced(filter.trim(), 250);
  const keys = useKeys(term ? globFor(term) : undefined);
  const qc = useQueryClient();
  const now = useNow();
  const searching = term !== "";

  // SCAN can return empty pages while the match is still ahead. Keep going until
  // something turns up or the keyspace is exhausted.
  const { isSuccess, data, isFetchingNextPage, fetchNextPage } = keys;
  useEffect(() => {
    if (
      isSuccess &&
      data.items.length === 0 &&
      data.hasMore &&
      !isFetchingNextPage
    ) {
      void fetchNextPage();
    }
  }, [isSuccess, data, isFetchingNextPage, fetchNextPage]);
  const input = useRef<HTMLInputElement>(null);

  // "/" jumps to the filter, like most developer tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === input.current) {
        setFilter("");
        input.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFilter]);

  // Shift+Cmd/Ctrl+C copies the selected key's name.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== "c") return;
      const name = useUi.getState().selected;
      if (!name) return;
      e.preventDefault();
      void copyText(name, "key name");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const status = keys.isError ? "err" : keys.isSuccess ? "on" : "idle";
  const loaded = keys.data?.items.length ?? 0;

  return (
    <aside className="sidebar">
      <div className="brand">
        <Mark />
        <span>Fogtrail</span>
      </div>

      <div className="card">
        <span
          className={`dot${status === "on" ? " dot--on" : status === "err" ? " dot--err" : ""}`}
        />
        <div className="card__text">
          <ConnectionSwitch />
          <span className="card__sub mono">
            {conn ? (
              <>
                <button
                  type="button"
                  className="card__version"
                  aria-pressed={view === "server"}
                  title="Server info"
                  onClick={() => setView(view === "server" ? "keys" : "server")}
                >
                  {conn.driver} <Chevron className="card__chev" />
                </button>
                {` · ${conn.address}`}
              </>
            ) : (
              "\u00a0"
            )}
          </span>
        </div>
        <button
          type="button"
          className="btn btn--small"
          onClick={openConnections}
        >
          Manage
        </button>
      </div>

      <div className="filter">
        <DatabaseSelect />
        <div className="filter__box">
          <input
            id="key-search"
            ref={input}
            type="search"
            aria-label="Search keys"
            placeholder="Search keys"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                document
                  .querySelector<HTMLButtonElement>(".tree button.row")
                  ?.focus();
              }
            }}
          />
          <kbd aria-hidden="true">/</kbd>
        </div>
        <button
          type="button"
          className={`icon-btn${keys.isFetching ? " icon-btn--spin" : ""}`}
          aria-label="Refresh keys"
          title={`Refresh (${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘R" : "Ctrl+R"})`}
          onClick={() => refreshAll(qc)}
        >
          <Refresh />
        </button>
      </div>

      {!searching && <Pinned />}

      <div className="keys-head">
        <div>
          <div className="section-label">
            {searching ? "Matches" : "Keys"}
            {keys.isSuccess
              ? ` · ${loaded}${keys.data.hasMore ? "+" : ""}`
              : ""}
          </div>
          {keys.isSuccess && (
            <div className="keys-head__scanned">
              Scanned{" "}
              {formatAgo(Math.max(0, (now - keys.dataUpdatedAt) / 1000))}
            </div>
          )}
        </div>
        <label
          className="delim"
          title="Each character here splits key names into folders, so :/ splits on both. Empty for a flat list."
        >
          Split on
          <input
            className="mono"
            aria-label="Folder delimiter"
            maxLength={3}
            value={delimiter}
            onChange={(e) => setDelimiter(e.target.value)}
          />
        </label>
      </div>

      {keys.isPending && (
        <div aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      )}
      {keys.isError && (
        <div role="alert" className="alert">
          {keys.error.message}
        </div>
      )}
      {keys.isSuccess && (
        <KeyTree keys={keys.data.items} searching={searching} />
      )}
      {keys.isSuccess && keys.data.hasMore && (
        <button
          type="button"
          className="more"
          disabled={keys.isFetchingNextPage}
          onClick={() => void keys.fetchNextPage()}
        >
          {keys.isFetchingNextPage ? "Loading…" : "Load more keys"}
        </button>
      )}

      <div className="sidebar__foot">
        <Lock />
        <span>Read-only. Fogtrail never writes.</span>
      </div>
    </aside>
  );
}
