import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { connect } from "../api/browse";
import { useProfiles, useQuickKeys } from "../api/queries";
import { useDebounced } from "../lib/useDebounced";
import { useUi } from "../state/ui";

interface Option {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

/** Cmd/Ctrl+K: jump to a key or switch connection by typing a few letters. */
export function QuickOpen() {
  const open = useUi((s) => s.quickOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const qc = useQueryClient();
  const base = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const term = useDebounced(text.trim(), 150);

  const connected = useUi((s) => s.connected);
  const connectedId = useUi((s) => s.connectedId);
  const recent = useUi((s) => s.recent);
  const pins = useUi((s) => s.pins);
  const reveal = useUi((s) => s.reveal);
  const setConnected = useUi((s) => s.setConnected);
  const close = () => useUi.getState().setQuickOpen(false);

  const profiles = useProfiles();
  const found = useQuickKeys(connected ? term : "");

  const switchTo = useMutation({
    mutationFn: async (id: string) => {
      qc.removeQueries({ queryKey: ["keys"] });
      qc.removeQueries({ queryKey: ["key"] });
      setConnected(await connect(id), id);
    },
  });

  useEffect(() => input.current?.focus(), []);

  const options = useMemo(() => {
    const out: Option[] = [];
    const needle = text.trim().toLowerCase();
    if (connected) {
      const names: [string, string][] = needle
        ? (found.data?.keys ?? []).map((n) => [n, "Keys"])
        : [
            ...pins.map((n): [string, string] => [n, "Pinned"]),
            ...recent
              .filter((n) => !pins.includes(n))
              .slice(0, 8)
              .map((n): [string, string] => [n, "Recent"]),
          ];
      for (const [name, group] of names) {
        out.push({
          id: `k:${name}`,
          group,
          label: name,
          run: () => {
            reveal(name);
            close();
          },
        });
      }
    }
    for (const p of profiles.data ?? []) {
      if (p.id === connectedId) continue;
      if (needle && !p.name.toLowerCase().includes(needle)) continue;
      out.push({
        id: `c:${p.id}`,
        group: "Connections",
        label: p.name,
        hint: `${p.host}:${p.port}`,
        run: () => switchTo.mutate(p.id),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, connected, connectedId, recent, pins, found.data, profiles.data]);

  const at = Math.min(active, Math.max(options.length - 1, 0));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(at + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(at - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      options[at]?.run();
    }
  };

  useEffect(() => {
    document
      .getElementById(`${base}-${at}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [at, base]);

  const searching = connected && term !== "" && found.isFetching;
  let lastGroup = "";

  return (
    <div className="quick__backdrop" onMouseDown={close}>
      <div
        className="quick"
        role="dialog"
        aria-label="Quick open"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          className="quick__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${base}-list`}
          aria-activedescendant={options[at] ? `${base}-${at}` : undefined}
          aria-label="Search keys and connections"
          placeholder={
            connected ? "Search keys and connections" : "Search connections"
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
        />
        <div id={`${base}-list`} role="listbox" className="quick__list">
          {options.map((o, i) => {
            const header = o.group !== lastGroup;
            lastGroup = o.group;
            return (
              <div key={o.id}>
                {header && <div className="quick__group">{o.group}</div>}
                <div
                  id={`${base}-${i}`}
                  role="option"
                  aria-selected={i === at}
                  className="quick__row"
                  onMouseMove={() => setActive(i)}
                  onClick={o.run}
                >
                  <span className="mono quick__label">{o.label}</span>
                  {o.hint && <span className="muted mono">{o.hint}</span>}
                </div>
              </div>
            );
          })}
          {options.length === 0 && (
            <p className="note">
              {searching
                ? "Searching…"
                : text.trim()
                  ? "No matches."
                  : "Nothing opened yet. Type to search."}
            </p>
          )}
          {searching && options.length > 0 && (
            <p className="note">Searching…</p>
          )}
          {switchTo.error && (
            <div role="alert" className="alert">
              {switchTo.error.message}
            </div>
          )}
        </div>
        <div className="quick__foot">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
