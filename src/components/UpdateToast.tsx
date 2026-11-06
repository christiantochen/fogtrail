import { useEffect } from "react";
import {
  checkForUpdates,
  dismissUpdate,
  installUpdate,
  percent,
} from "../lib/updater";
import { useUpdate } from "../state/update";

/** Self-update notices: a card in the corner, so it never shifts the layout. */
export function UpdateToast() {
  const status = useUpdate((s) => s.status);

  // Look for a new release shortly after launch. The dev server has none to find.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    const t = window.setTimeout(() => void checkForUpdates(false), 4000);
    return () => window.clearTimeout(t);
  }, []);

  // "Up to date" is good news, so it doesn't need to be closed by hand.
  useEffect(() => {
    if (status.kind !== "upToDate") return;
    const t = window.setTimeout(dismissUpdate, 4000);
    return () => window.clearTimeout(t);
  }, [status.kind]);

  if (status.kind === "idle") return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      {status.kind === "checking" && <p>Checking for updates…</p>}
      {status.kind === "upToDate" && <p>You are on the latest version.</p>}
      {status.kind === "available" && (
        <>
          <p>
            <strong>Fogtrail {status.version}</strong> is available.
          </p>
          <div className="toast__actions">
            <button
              type="button"
              className="btn btn--small"
              onClick={dismissUpdate}
            >
              Later
            </button>
            <button
              type="button"
              className="btn btn--small btn--primary"
              onClick={() => void installUpdate()}
            >
              Install and restart
            </button>
          </div>
        </>
      )}
      {status.kind === "downloading" && (
        <>
          <p>Downloading {status.version}…</p>
          <progress
            max={100}
            value={percent(status.downloaded, status.total) ?? undefined}
            aria-label="Download progress"
          />
        </>
      )}
      {status.kind === "restarting" && <p>Restarting into {status.version}…</p>}
      {status.kind === "error" && (
        <>
          <p role="alert">Couldn’t update: {status.message}</p>
          <div className="toast__actions">
            <button
              type="button"
              className="btn btn--small"
              onClick={dismissUpdate}
            >
              Close
            </button>
          </div>
        </>
      )}
    </div>
  );
}
