import { useEffect, useState, useSyncExternalStore } from "react";
import { formatAgo, REFRESH_OPTIONS } from "../lib/refresh";
import { useUi } from "../state/ui";

const subscribe = (cb: () => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
const visible = () => document.visibilityState !== "hidden";

/** Picks how often the open key is re-read, and says whether that is happening. */
export function AutoRefresh({
  updatedAt,
  failed,
}: {
  updatedAt: number;
  failed: boolean;
}) {
  const every = useUi((s) => s.refreshEvery);
  const setEvery = useUi((s) => s.setRefreshEvery);
  const shown = useSyncExternalStore(subscribe, visible, () => true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (every === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [every]);

  const paused = failed || !shown;
  const ago = formatAgo(Math.max(0, (now - updatedAt) / 1000));
  return (
    <>
      {every > 0 && (
        <span className={`live${paused ? " live--paused" : ""}`} role="status">
          <span className="live__dot" />
          {paused
            ? failed
              ? "Paused · can’t reach the server"
              : "Paused · window in background"
            : `Live · updated ${ago}`}
        </span>
      )}
      <label className="autorefresh">
        <span>Auto-refresh</span>
        <select
          aria-label="Auto-refresh"
          value={every}
          onChange={(e) => setEvery(Number(e.target.value))}
        >
          {REFRESH_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 0 ? "Off" : `Every ${s}s`}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
