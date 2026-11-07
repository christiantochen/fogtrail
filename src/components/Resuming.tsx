import { useEffect, useRef, useState } from "react";
import {
  connect,
  disconnect,
  listProfiles,
  selectDatabase,
} from "../api/browse";
import { useProfiles } from "../api/queries";
import { loadSession } from "../lib/session";
import { useUi } from "../state/ui";
import { Mark } from "./Icons";

/** Shown at launch while the last connection is reopened. */
export function Resuming() {
  const [session] = useState(loadSession);
  const profiles = useProfiles();
  const name = profiles.data?.find((p) => p.id === session?.profileId)?.name;
  const cancelled = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !session) return;
    started.current = true;
    const ui = useUi.getState();
    void (async () => {
      let profileName = "";
      try {
        const profile = (await listProfiles()).find(
          (p) => p.id === session.profileId,
        );
        if (!profile) throw new Error("That connection no longer exists.");
        profileName = profile.name;
        let info = await connect(profile.id);
        if (info.database !== session.database) {
          info = await selectDatabase(session.database).catch(() => info);
        }
        if (cancelled.current) {
          await disconnect().catch(() => undefined);
          return;
        }
        ui.setConnected(info, profile.id);
        ui.restore(session);
        ui.setResuming(false);
      } catch (e) {
        if (cancelled.current) return;
        // Backend failures arrive as AppError objects, not Error instances.
        const reason = (e as { message?: string }).message ?? "Unknown error.";
        ui.setLaunchError(
          profileName
            ? `Couldn’t reconnect to ${profileName}: ${reason}`
            : reason,
        );
        ui.setResuming(false);
      }
    })();
  }, [session]);

  if (!session) return null;
  const where =
    session.selected ?? (session.expanded[session.expanded.length - 1] || null);

  return (
    <main className="resume">
      <Mark />
      <h1>{name ? `Reconnecting to ${name}…` : "Reconnecting…"}</h1>
      <p className="muted">
        Back to database {session.database}
        {where ? (
          <>
            , at <span className="mono">{where}</span>
          </>
        ) : null}
        .
      </p>
      <button
        type="button"
        className="btn"
        onClick={() => {
          cancelled.current = true;
          useUi.getState().setResuming(false);
        }}
      >
        Choose another
      </button>
    </main>
  );
}
