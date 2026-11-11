import type { Theme } from "./theme";

// The menus drawn by our own title bar (Windows). They mirror the native menu
// in src-tauri/src/menu.rs, which macOS and Linux still use.

/** A menu entry. `id` is a menu id from menu.ts, a window action or an edit command. */
export interface Entry {
  id: string;
  label: string;
  /** Shown on the right, e.g. "Ctrl+N". */
  keys?: string;
  /** Marks a theme choice: the title bar ticks the one that is current. */
  theme?: Theme;
}
export type Item = Entry | "-";

export interface Menu {
  label: string;
  /** Alt+this opens the menu. */
  mnemonic: string;
  items: Item[];
}

export const MENUS: Menu[] = [
  {
    label: "File",
    mnemonic: "f",
    items: [
      { id: "new-connection", label: "New Connection…", keys: "Ctrl+N" },
      { id: "connections", label: "Connections", keys: "Ctrl+Shift+O" },
      "-",
      { id: "win:close", label: "Close Window", keys: "Alt+F4" },
      { id: "win:exit", label: "Exit" },
    ],
  },
  {
    label: "Edit",
    mnemonic: "e",
    items: [
      { id: "edit:undo", label: "Undo", keys: "Ctrl+Z" },
      { id: "edit:redo", label: "Redo", keys: "Ctrl+Y" },
      "-",
      { id: "edit:cut", label: "Cut", keys: "Ctrl+X" },
      { id: "edit:copy", label: "Copy", keys: "Ctrl+C" },
      { id: "edit:paste", label: "Paste", keys: "Ctrl+V" },
      { id: "edit:selectAll", label: "Select All", keys: "Ctrl+A" },
    ],
  },
  {
    label: "View",
    mnemonic: "v",
    items: [
      { id: "quick-open", label: "Quick Open…", keys: "Ctrl+K" },
      { id: "search", label: "Search Keys", keys: "Ctrl+F" },
      { id: "find-value", label: "Find in Value", keys: "Ctrl+Shift+F" },
      { id: "refresh", label: "Refresh", keys: "Ctrl+R" },
      { id: "server-info", label: "Server Info", keys: "Ctrl+I" },
      "-",
      { id: "theme-system", label: "Theme: System", theme: "system" },
      { id: "theme-light", label: "Theme: Light", theme: "light" },
      { id: "theme-dark", label: "Theme: Dark", theme: "dark" },
      "-",
      { id: "win:fullscreen", label: "Toggle Full Screen", keys: "F11" },
    ],
  },
  {
    label: "Window",
    mnemonic: "w",
    items: [
      { id: "win:minimize", label: "Minimize" },
      { id: "win:maximize", label: "Maximize or Restore" },
    ],
  },
  {
    label: "Help",
    mnemonic: "h",
    items: [
      { id: "check-updates", label: "Check for Updates…" },
      "-",
      { id: "about", label: "About Fogtrail" },
    ],
  },
];

/**
 * Shortcuts the native menu used to provide. Ctrl+K, Ctrl+Shift+F and
 * Ctrl+Shift+C are already handled where they apply, so they are not here.
 */
export function shortcutFor(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): string | null {
  if (e.altKey) return null;
  const k = e.key.toLowerCase();
  if (e.key === "F11" && !e.ctrlKey && !e.metaKey) return "win:fullscreen";
  if (!(e.ctrlKey || e.metaKey)) return null;
  if (e.shiftKey) return k === "o" ? "connections" : null;
  switch (k) {
    case "n":
      return "new-connection";
    case "f":
      return "search";
    case "r":
      return "refresh";
    case "i":
      return "server-info";
    default:
      return null;
  }
}

/** The menu whose Alt+letter this is, or -1. */
export function mnemonicIndex(e: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): number {
  if (!e.altKey || e.ctrlKey || e.metaKey) return -1;
  return MENUS.findIndex((m) => m.mnemonic === e.key.toLowerCase());
}

/** Edit commands run on whatever has focus, like the native Edit menu. */
export function runEdit(command: string): void {
  if (command === "paste") {
    void navigator.clipboard
      ?.readText()
      .then((t) => document.execCommand("insertText", false, t))
      .catch(() => undefined);
    return;
  }
  document.execCommand(command);
}
