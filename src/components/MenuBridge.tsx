import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { runMenuAction } from "../lib/menu";
import { menuHandlers } from "../lib/menuHandlers";

/** Connects native menu clicks to the UI. Renders nothing. */
export function MenuBridge() {
  const qc = useQueryClient();

  useEffect(() => {
    const handlers = menuHandlers(qc);

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    // Outside Tauri (a plain browser during development) there is no menu to hear.
    listen<string>("menu", (e) => runMenuAction(e.payload, handlers))
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [qc]);

  return null;
}
