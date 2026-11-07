import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdates } from "../lib/updater";
import { useUi } from "../state/ui";
import { Mark } from "./Icons";

/** Help > About Fogtrail (Windows; macOS has its own About window). */
export function About() {
  const open = useUi((s) => s.about);
  if (!open) return null;
  return <Dialog />;
}

function Dialog() {
  const close = () => useUi.getState().setAbout(false);
  const [version, setVersion] = useState<string | null>(null);
  const done = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    getVersion()
      .then((v) => live && setVersion(v))
      .catch(() => undefined);
    done.current?.focus();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="quick__backdrop about__backdrop" onMouseDown={close}>
      <div
        className="about"
        role="dialog"
        aria-label="About Fogtrail"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        }}
      >
        <Mark />
        <h2>Fogtrail</h2>
        <p className="about__version mono">
          {version ? `Version ${version}` : " "}
        </p>
        <p>A desktop data browser. Find your way through your data.</p>
        <p className="about__muted">
          Read-only: Fogtrail never writes to the server you connect to.
        </p>
        <p className="about__muted">
          Copyright © Christianto Chen. MIT OR Apache-2.0.
        </p>
        <div className="about__actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              close();
              void checkForUpdates(true);
            }}
          >
            Check for updates
          </button>
          <button
            ref={done}
            type="button"
            className="btn btn--primary"
            onClick={close}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
