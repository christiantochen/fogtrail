import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProfiles } from "../api/queries";
import {
  MENUS,
  mnemonicIndex,
  runEdit,
  shortcutFor,
  type Entry,
} from "../lib/appMenu";
import { runMenuAction } from "../lib/menu";
import { menuHandlers } from "../lib/menuHandlers";
import {
  isFullscreen,
  isMaximized,
  onResized,
  toggleFullscreen,
  windowAction,
} from "../lib/windowApi";
import { useUi } from "../state/ui";
import { Mark } from "./Icons";

/**
 * Windows draws no frame for us, so this is the title bar and the menu bar in one
 * row, like VS Code. macOS and Linux keep their native frame and menus.
 */
export function TitleBar() {
  const custom = useUi((s) => s.customTitleBar);
  return custom === true ? <Bar /> : null;
}

const entries = (i: number) =>
  MENUS[i].items.filter((x): x is Entry => x !== "-");

function Bar() {
  const qc = useQueryClient();
  const handlers = useMemo(() => menuHandlers(qc), [qc]);
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const drop = useRef<HTMLDivElement>(null);
  const before = useRef<Element | null>(null);

  const theme = useUi((s) => s.theme);
  const connectedId = useUi((s) => s.connectedId);
  const selected = useUi((s) =>
    s.connected?.store === "sql"
      ? s.sqlTable
        ? `${s.sqlSchema}.${s.sqlTable}`
        : null
      : s.selected,
  );
  const profiles = useProfiles();
  const name = profiles.data?.find((p) => p.id === connectedId)?.name;

  const sync = () => void isMaximized().then(setMaximized);
  useEffect(() => {
    sync();
    // The window may come back in full screen from last time.
    void isFullscreen().then(setFullscreen);
    return onResized(sync);
  }, []);

  const run = (id: string) => {
    // Like GitHub Desktop: the bar hides once the window fills the screen.
    if (id === "win:fullscreen")
      void toggleFullscreen().then((on) => on !== null && setFullscreen(on));
    else if (id.startsWith("win:")) void windowAction(id).then(sync);
    else if (id.startsWith("edit:")) runEdit(id.slice(5));
    else runMenuAction(id, handlers);
  };

  const close = () => {
    setOpen(null);
    const el = before.current as HTMLElement | null;
    before.current = null;
    // Put focus back so Edit commands act on what the user was in.
    if (el?.isConnected) el.focus();
  };
  const show = (i: number, byKeyboard: boolean) => {
    if (open === null) before.current = document.activeElement;
    setOpen(i);
    setActive(0);
    if (byKeyboard) queueMicrotask(() => drop.current?.focus());
  };
  const choose = (id: string) => {
    close();
    run(id);
  };

  // Shortcuts the native menu used to provide, and Alt+letter to open a menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = mnemonicIndex(e);
      // In full screen the bar is hidden, so there is no menu to open.
      if (m >= 0 && !fullscreen) {
        e.preventDefault();
        show(m, true);
        return;
      }
      const id = shortcutFor(e);
      if (id) {
        e.preventDefault();
        run(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // While a menu is open: arrows, Enter, Escape, and clicking away.
  useEffect(() => {
    if (open === null) return;
    const items = entries(open);
    const onKey = (e: KeyboardEvent) => {
      const go = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };
      if (e.key === "Escape") go(close);
      else if (e.key === "ArrowDown")
        go(() => setActive((active + 1) % items.length));
      else if (e.key === "ArrowUp")
        go(() => setActive((active - 1 + items.length) % items.length));
      else if (e.key === "Home") go(() => setActive(0));
      else if (e.key === "End") go(() => setActive(items.length - 1));
      else if (e.key === "ArrowRight")
        go(() => show((open + 1) % MENUS.length, true));
      else if (e.key === "ArrowLeft")
        go(() => show((open - 1 + MENUS.length) % MENUS.length, true));
      else if (e.key === "Enter" || e.key === " ")
        go(() => choose(items[active].id));
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".titlebar__menus, .titlebar__drop"))
        close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("blur", close);
    };
  });

  const label = name
    ? selected
      ? `${name} › ${selected}`
      : name
    : "Search keys and connections";

  return (
    <>
      {fullscreen && <FullscreenHint />}
      {/* Hidden, not removed, in full screen: its shortcuts (F11 to leave) still work. */}
      <header className="titlebar" hidden={fullscreen} data-tauri-drag-region>
        <span className="titlebar__mark" data-tauri-drag-region>
          <Mark aria-hidden />
        </span>
        <nav className="titlebar__menus" role="menubar" aria-label="Menu">
          {MENUS.map((m, i) => (
            <button
              key={m.label}
              type="button"
              role="menuitem"
              className="titlebar__menu"
              aria-haspopup="menu"
              aria-expanded={open === i}
              // Keep focus where it was, so Edit commands act on the right field.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (open === i ? close() : show(i, false))}
              onMouseEnter={() => open !== null && open !== i && show(i, false)}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div className="titlebar__center" data-tauri-drag-region>
          <button
            type="button"
            className="titlebar__search"
            aria-label="Quick open"
            onClick={() => useUi.getState().setQuickOpen(true)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
              <circle
                cx="7"
                cy="7"
                r="4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M10.5 10.5L14 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span className={name ? undefined : "titlebar__hint"}>{label}</span>
          </button>
        </div>
        <div className="titlebar__ctls">
          <button
            type="button"
            className="titlebar__ctl"
            aria-label="Minimize"
            tabIndex={-1}
            onClick={() => void windowAction("win:minimize")}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M0 5h10" stroke="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="titlebar__ctl"
            aria-label={maximized ? "Restore" : "Maximize"}
            tabIndex={-1}
            onClick={() => void windowAction("win:maximize")}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path
                  d="M2.5 2.5V.5h7v7h-2"
                  fill="none"
                  stroke="currentColor"
                />
                <rect
                  x=".5"
                  y="2.5"
                  width="7"
                  height="7"
                  fill="none"
                  stroke="currentColor"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <rect
                  x=".5"
                  y=".5"
                  width="9"
                  height="9"
                  fill="none"
                  stroke="currentColor"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="titlebar__ctl titlebar__ctl--close"
            aria-label="Close"
            tabIndex={-1}
            onClick={() => void windowAction("win:close")}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" />
            </svg>
          </button>
        </div>

        {open !== null && (
          <div
            ref={drop}
            className="titlebar__drop"
            role="menu"
            aria-label={MENUS[open].label}
            aria-activedescendant={`tb-item-${active}`}
            tabIndex={-1}
            style={{ left: dropLeft(open) }}
          >
            {MENUS[open].items.map((it, n) => {
              if (it === "-")
                return (
                  <div key={n} className="titlebar__sep" role="separator" />
                );
              const i = entries(open).indexOf(it);
              return (
                <div
                  key={it.id}
                  id={`tb-item-${i}`}
                  role={it.theme ? "menuitemradio" : "menuitem"}
                  aria-checked={it.theme ? it.theme === theme : undefined}
                  className="titlebar__item"
                  aria-current={i === active ? "true" : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(it.id)}
                >
                  <span className="titlebar__tick" aria-hidden="true">
                    {it.theme && it.theme === theme ? "✓" : ""}
                  </span>
                  <span className="titlebar__label">{it.label}</span>
                  <span className="titlebar__keys">{it.keys}</span>
                </div>
              );
            })}
          </div>
        )}
      </header>
    </>
  );
}

/** How long the full screen hint stays, fade included (see .fs-hint in styles.css). */
const HINT_MS = 2500;

/** "Press F11 to exit full screen", for a moment after the bar hides. */
function FullscreenHint() {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShown(false), HINT_MS);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <div className="fs-hint" role="status">
      Press <kbd>F11</kbd> to exit full screen
    </div>
  );
}

/** Where the open menu hangs: under its button. */
function dropLeft(i: number): number {
  const buttons = document.querySelectorAll<HTMLElement>(".titlebar__menu");
  const bar = document.querySelector<HTMLElement>(".titlebar");
  const b = buttons[i];
  return b && bar ? b.offsetLeft - bar.offsetLeft : 32;
}
