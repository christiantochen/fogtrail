import { useEffect, useRef } from "react";
import { areasFor, isMac, keyLabel, shortcutsOf } from "../lib/shortcuts";
import { useUi } from "../state/ui";
import { useEscape } from "./useEscape";

/** The keyboard shortcuts sheet: `?`, Help > Keyboard Shortcuts. */
export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcuts);
  if (!open) return null;
  return <Sheet />;
}

function Sheet() {
  const store = useUi((s) => s.connected?.store ?? null);
  const close = () => useUi.getState().setShortcuts(false);
  const done = useRef<HTMLButtonElement>(null);
  const mac = isMac();
  // Keeps an Esc nobody handled from leaving full screen on macOS.
  useEscape();
  useEffect(() => done.current?.focus(), []);

  const groups = areasFor(store);
  // Two columns, filled in order: the first half of the groups on the left.
  const split = Math.ceil(groups.length / 2);
  const columns = [groups.slice(0, split), groups.slice(split)].filter(
    (c) => c.length > 0,
  );

  return (
    <div
      className="scrim scrim--top"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="shortcuts"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            // The row dialog behind also steps back on Esc; this one is only for the sheet.
            e.stopPropagation();
            close();
          } else if (e.key === "Tab") {
            // One button to focus, so Tab stays on it.
            e.preventDefault();
          }
        }}
      >
        <div className="shortcuts__head">
          <div className="shortcuts__title">
            <span className="rowpanel__label">Fogtrail</span>
            <h2>Keyboard shortcuts</h2>
          </div>
          <span className="shortcuts__note">
            {mac ? "On Windows, ⌘ is Ctrl" : "On a Mac, Ctrl is ⌘ (Cmd)"}
          </span>
          <button ref={done} type="button" className="btn" onClick={close}>
            Close <kbd className="rowdialog__kbd">Esc</kbd>
          </button>
        </div>
        <div className="shortcuts__body">
          {columns.map((col, i) => (
            <div key={i} className="shortcuts__col">
              {col.map((a) => (
                <section key={a.id} className="shortcuts__group">
                  <h3 className="rowpanel__label">{a.title}</h3>
                  <ul>
                    {shortcutsOf(a.id).map((s) => (
                      <li key={s.label} className="shortcuts__row">
                        <span>{s.label}</span>
                        <span className="shortcuts__keys">
                          {s.keys.map((k) => (
                            <kbd key={k} className="keycap">
                              {keyLabel(k, mac)}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ))}
        </div>
        <div className="shortcuts__foot">
          <span>Open this list any time with</span>
          <kbd className="keycap">?</kbd>
          <span>or from Help › Keyboard Shortcuts.</span>
        </div>
      </div>
    </div>
  );
}
