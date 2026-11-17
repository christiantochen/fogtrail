/**
 * Every keyboard shortcut, in one place. The shortcuts sheet draws from it, and so does the
 * table in the README (a test keeps the two equal), so a key can't be added to one and forgotten
 * in the other. The keys themselves are handled where they apply.
 */

export type Area = "everywhere" | "tables" | "rows" | "editor" | "keys";

/**
 * One key of a combination. `mod` is Cmd on a Mac and Ctrl on Windows. The rest are named
 * (`enter`, `esc`, `up`...) or the key itself.
 */
export type Key = string;

export interface Shortcut {
  area: Area;
  label: string;
  /** Pressed together, in order. With `either`, any one of them does it. */
  keys: Key[];
  either?: boolean;
}

export interface AreaInfo {
  id: Area;
  title: string;
  /** Shown only on this kind of connection. Everywhere is always shown. */
  store?: "sql" | "keyValue";
}

export const AREAS: AreaInfo[] = [
  { id: "everywhere", title: "Everywhere" },
  { id: "tables", title: "Table rows", store: "sql" },
  { id: "rows", title: "Row panel and dialog", store: "sql" },
  { id: "editor", title: "Query editor", store: "sql" },
  { id: "keys", title: "Key browser (Redis)", store: "keyValue" },
];

export const SHORTCUTS: Shortcut[] = [
  {
    area: "everywhere",
    label: "Quick open: tables, keys, connections",
    keys: ["mod", "K"],
  },
  {
    area: "everywhere",
    label: "Find: filter tables or keys, or search an open row",
    keys: ["mod", "F"],
  },
  { area: "everywhere", label: "Jump to the filter", keys: ["/"] },
  { area: "everywhere", label: "Refresh", keys: ["mod", "R"] },
  { area: "everywhere", label: "New connection", keys: ["mod", "N"] },
  {
    area: "everywhere",
    label: "Back to connections",
    keys: ["shift", "mod", "O"],
  },
  { area: "everywhere", label: "This list", keys: ["?"] },

  {
    area: "tables",
    label: "Move between rows",
    keys: ["up", "down"],
    either: true,
  },
  { area: "tables", label: "Open the row panel (or Space)", keys: ["enter"] },
  { area: "tables", label: "Expand the row in a dialog", keys: ["E"] },
  { area: "tables", label: "Copy the table name", keys: ["shift", "mod", "C"] },

  {
    area: "rows",
    label: "Previous or next row",
    keys: ["up", "down"],
    either: true,
  },
  { area: "rows", label: "Find in the row", keys: ["/"] },
  { area: "rows", label: "Expand to a dialog (from the panel)", keys: ["E"] },
  { area: "rows", label: "Clear the search, then close", keys: ["esc"] },

  { area: "editor", label: "Run the query", keys: ["mod", "enter"] },
  { area: "editor", label: "Show suggestions", keys: ["ctrl", "space"] },
  { area: "editor", label: "Accept a suggestion (or Enter)", keys: ["tab"] },

  {
    area: "keys",
    label: "Move through keys",
    keys: ["up", "down"],
    either: true,
  },
  {
    area: "keys",
    label: "Open or close a folder",
    keys: ["left", "right"],
    either: true,
  },
  { area: "keys", label: "Find in the value", keys: ["shift", "mod", "F"] },
  { area: "keys", label: "Server info", keys: ["mod", "I"] },
];

const MAC: Record<string, string> = {
  mod: "⌘",
  shift: "⇧",
  ctrl: "⌃",
  alt: "⌥",
  enter: "↵",
  esc: "Esc",
  tab: "Tab",
  space: "Space",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};
const WIN: Record<string, string> = {
  ...MAC,
  mod: "Ctrl",
  shift: "Shift",
  ctrl: "Ctrl",
  alt: "Alt",
  enter: "Enter",
};
const README: Record<string, string> = {
  ...WIN,
  mod: "Cmd/Ctrl",
};

/** What to print on a key cap: ⌘ on a Mac, Ctrl on Windows. */
export function keyLabel(key: Key, mac: boolean): string {
  return (mac ? MAC : WIN)[key] ?? key;
}

/** True on a Mac. Read from the user agent, which the webview sets for the OS. */
export function isMac(): boolean {
  try {
    return /Mac|iPhone|iPad/.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/** Which groups to show: Everywhere, plus the ones for this kind of connection. */
export function areasFor(store: "sql" | "keyValue" | null): AreaInfo[] {
  return AREAS.filter((a) => !a.store || a.store === store);
}

export function shortcutsOf(area: Area): Shortcut[] {
  return SHORTCUTS.filter((s) => s.area === area);
}

/** "Cmd/Ctrl + Shift + O", or "↑ / ↓" where any one key works. */
export function readmeKeys(s: Shortcut): string {
  return s.keys.map((k) => README[k] ?? k).join(s.either ? " / " : " + ");
}

export const README_START = "<!-- shortcuts:start -->";
export const README_END = "<!-- shortcuts:end -->";

/** The README's shortcuts table, as Markdown. Prettier lines up the columns afterwards. */
export function readmeTable(): string {
  const rows = SHORTCUTS.map((s) => {
    const area = AREAS.find((a) => a.id === s.area)?.title ?? s.area;
    return `| ${readmeKeys(s)} | ${s.label} | ${area} |`;
  });
  return ["| Shortcut | Action | Where |", "| --- | --- | --- |", ...rows].join(
    "\n",
  );
}

/** Pairs of shortcuts in one area that use the same key. Empty when there are none. */
export function clashes(list: readonly Shortcut[] = SHORTCUTS): string[] {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const s of list) {
    const chords = s.either ? s.keys.map((k) => [k]) : [s.keys];
    for (const chord of chords) {
      const id = `${s.area}:${chord.join("+")}`;
      const was = seen.get(id);
      if (was !== undefined) out.push(`${id}: "${was}" and "${s.label}"`);
      else seen.set(id, s.label);
    }
  }
  return out;
}
