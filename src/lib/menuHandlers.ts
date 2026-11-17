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
      const { connected } = ui();
      if (!connected) return;
      // Find where you are: a dialog's own search box comes first, and nothing
      // behind a dialog takes the focus.
      const modal = document.querySelector('[aria-modal="true"]');
      let box: HTMLInputElement | null | undefined;
      if (modal) box = modal.querySelector<HTMLInputElement>(".find__input");
      else if (connected.store === "sql")
        box = document.querySelector<HTMLInputElement>("#table-filter");
      else {
        ui().setView("keys");
        box = document.querySelector<HTMLInputElement>("#key-search");
      }
      box?.focus();
      box?.select();
    },
    refresh: () => {
      if (!ui().connected) return;
      refreshAll(qc);
    },
    quickOpen: () => ui().setQuickOpen(true),
    findValue: () => window.dispatchEvent(new Event(FIND_VALUE_EVENT)),
    checkUpdates: () => void checkForUpdates(true),
    about: () => ui().setAbout(true),
    themeSystem: () => ui().setTheme("system"),
    themeLight: () => ui().setTheme("light"),
    themeDark: () => ui().setTheme("dark"),
    serverInfo: () => {
      if (!ui().connected) return;
      ui().setView(ui().view === "server" ? "keys" : "server");
    },
  };
}
