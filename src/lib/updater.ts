import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useUpdate } from "../state/update";

/** The release found by the last check, kept until it is installed or dismissed. */
let pending: Update | null = null;

const show = useUpdate.getState().set;

/** Download progress as 0-100, or null when the size isn't known. */
export function percent(
  downloaded: number,
  total: number | null,
): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Asks GitHub whether a newer release exists. A check on launch (`manual` false)
 * stays silent unless there is something to install; one from the menu always
 * says what happened.
 */
export async function checkForUpdates(manual: boolean): Promise<void> {
  const busy = useUpdate.getState().status.kind;
  if (busy === "checking" || busy === "downloading" || busy === "restarting")
    return;
  if (manual) show({ kind: "checking" });
  try {
    const update = await check();
    if (update) {
      pending = update;
      show({
        kind: "available",
        version: update.version,
        notes: update.body ?? null,
      });
    } else if (manual) {
      show({ kind: "upToDate" });
    } else {
      show({ kind: "idle" });
    }
  } catch (e) {
    show(manual ? { kind: "error", message: describe(e) } : { kind: "idle" });
  }
}

/** Downloads and installs the pending release, then restarts into it. */
export async function installUpdate(): Promise<void> {
  const update = pending;
  if (!update) return;
  const version = update.version;
  let downloaded = 0;
  let total: number | null = null;
  show({ kind: "downloading", version, downloaded, total });
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? null;
      if (event.event === "Progress") downloaded += event.data.chunkLength;
      if (event.event === "Finished") return;
      show({ kind: "downloading", version, downloaded, total });
    });
    show({ kind: "restarting", version });
    await relaunch();
  } catch (e) {
    show({ kind: "error", message: describe(e) });
  }
}

export function dismissUpdate(): void {
  show({ kind: "idle" });
}
