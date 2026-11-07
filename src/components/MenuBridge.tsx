import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { runMenuAction } from "../lib/menu";
import { FIND_VALUE_EVENT } from "../lib/find";
import { useUi } from "../state/ui";

/** Connects native menu clicks to the UI. Renders nothing. */
export function MenuBridge() {
  const qc = useQueryClient();

  useEffect(() => {
    // Read the store at click time so the handlers never see stale state.
    const ui = () => useUi.getState();
    const handlers = {
      newConnection: () => {
        ui().openConnections();
        ui().edit("new");
      },
      connections: () => {
        // Toggle: the live connection stays open underneath.
        const { connected, picking } = ui();
        if (connected && picking) ui().resume();
        else if (connected) ui().openConnections();
        else ui().edit(null);
      },
      search: () => {
        if (!ui().connected) return;
        ui().setView("keys");
        document.getElementById("key-search")?.focus();
      },
      refresh: () => {
        if (!ui().connected) return;
        void qc.invalidateQueries({ queryKey: ["keys"] });
        void qc.invalidateQueries({ queryKey: ["key"] });
        void qc.invalidateQueries({ queryKey: ["serverInfo"] });
      },
      quickOpen: () => ui().setQuickOpen(true),
      findValue: () => window.dispatchEvent(new Event(FIND_VALUE_EVENT)),
      serverInfo: () => {
        if (!ui().connected) return;
        ui().setView(ui().view === "server" ? "keys" : "server");
      },
    };

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
