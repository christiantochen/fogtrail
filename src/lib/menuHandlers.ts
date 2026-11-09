import type { QueryClient } from "@tanstack/react-query";
import { FIND_VALUE_EVENT } from "./find";
import type { MenuHandlers } from "./menu";
import { refreshAll } from "./refreshAll";
import { checkForUpdates } from "./updater";
import { useUi } from "../state/ui";

/** What each menu item does. Shared by the native menu and our own title bar. */
export function menuHandlers(qc: QueryClient): MenuHandlers {
  // Read the store at click time so the handlers never see stale state.
  const ui = () => useUi.getState();
  return {
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
      refreshAll(qc);
    },
    quickOpen: () => ui().setQuickOpen(true),
    findValue: () => window.dispatchEvent(new Event(FIND_VALUE_EVENT)),
    checkUpdates: () => void checkForUpdates(true),
    about: () => ui().setAbout(true),
    serverInfo: () => {
      if (!ui().connected) return;
      ui().setView(ui().view === "server" ? "keys" : "server");
    },
  };
}
