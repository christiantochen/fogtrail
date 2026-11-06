/** What the native menu can ask the UI to do. Ids match src-tauri/src/menu.rs. */
export interface MenuHandlers {
  newConnection: () => void;
  connections: () => void;
  search: () => void;
  refresh: () => void;
  serverInfo: () => void;
  quickOpen: () => void;
  findValue: () => void;
  checkUpdates: () => void;
}

// A Map, so ids like "toString" can't match something inherited from Object.
const ROUTES = new Map<string, keyof MenuHandlers>([
  ["new-connection", "newConnection"],
  ["connections", "connections"],
  ["search", "search"],
  ["refresh", "refresh"],
  ["server-info", "serverInfo"],
  ["quick-open", "quickOpen"],
  ["find-value", "findValue"],
  ["check-updates", "checkUpdates"],
]);

/** Runs the handler for a menu item id. Returns false for ids it doesn't know (such as predefined items). */
export function runMenuAction(id: string, handlers: MenuHandlers): boolean {
  const name = ROUTES.get(id);
  if (!name) return false;
  handlers[name]();
  return true;
}
