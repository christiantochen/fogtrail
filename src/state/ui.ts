import { create } from "zustand";
import type { ConnectionInfo } from "../api/types";
import { loadRefresh, saveRefresh } from "../lib/refresh";
import { loadPins, savePins, togglePin } from "../lib/pins";
import { loadRecent, pushRecent, saveRecent } from "../lib/recent";
import { loadSession, type Session } from "../lib/session";
import { toggleColumnPin } from "../lib/sql";
import type { SortMode } from "../lib/keysort";
import { ancestorsOf } from "../lib/tree";

const DELIMITER_KEY = "fogtrail.delimiter";

function loadDelimiter(): string {
  try {
    return localStorage.getItem(DELIMITER_KEY) ?? ":";
  } catch {
    return ":";
  }
}

/** Adds a just-opened key to this connection's recent list and saves it. */
function remember(
  s: { connectedId: string | null; recent: string[] },
  name: string | null,
): string[] {
  if (!name || !s.connectedId) return s.recent;
  const next = pushRecent(s.recent, name);
  saveRecent(s.connectedId, next);
  return next;
}

interface UiState {
  /** What splits key names into folders. Empty means a flat list. */
  delimiter: string;
  setDelimiter: (value: string) => void;
  /** The live connection, or null when there is none. */
  connected: ConnectionInfo | null;
  /** Saved profile the live connection came from. */
  connectedId: string | null;
  /** True while the connections screen is open on top of a live connection. */
  picking: boolean;
  /** Profile id being edited, "new" for a blank form, or null. */
  editing: string | null;
  /** What the main area shows while connected. */
  view: "keys" | "server";
  selected: string | null;
  filter: string;
  /** SQL browsing (MySQL): the open schema and table, the tab and the page. */
  sqlSchema: string | null;
  sqlTable: string | null;
  sqlTab: "data" | "structure";
  /** Rows skipped before the page on screen. */
  sqlOffset: number;
  /** A SQL expression narrowing the rows on screen (the part after WHERE). */
  sqlFilter: string;
  /** The column the rows are sorted by, or null for the table's own order. */
  sqlSort: { column: string; desc: boolean } | null;
  /** Columns pinned to the left of the open table, in the order they were pinned. */
  sqlPinned: string[];
  /** The query editor is open in place of a table. */
  sqlQueryOpen: boolean;
  /** What is typed in the editor. Kept while you look at tables and come back. */
  sqlText: string;
  openQueryEditor: () => void;
  setSqlText: (text: string) => void;
  selectSchema: (schema: string | null) => void;
  selectTable: (table: string | null) => void;
  setSqlTab: (tab: "data" | "structure") => void;
  setSqlOffset: (offset: number) => void;
  /** Changing the filter or the sort goes back to the first page. */
  setSqlFilter: (filter: string) => void;
  setSqlSort: (sort: { column: string; desc: boolean } | null) => void;
  togglePinnedColumn: (column: string) => void;
  /** Only keys of this type (a SCAN TYPE), or null for all. Not remembered. */
  kindFilter: string | null;
  setKindFilter: (kind: string | null) => void;
  /** Tree by name, or a flat list by soonest expiry. Not remembered. */
  sort: SortMode;
  setSort: (sort: SortMode) => void;
  /** Folder paths the user has opened. */
  expanded: ReadonlySet<string>;
  /** Quick open (Cmd/Ctrl+K) is showing. */
  quickOpen: boolean;
  setQuickOpen: (open: boolean) => void;
  /** The About dialog is showing. */
  about: boolean;
  /** We draw the title bar and menus ourselves (Windows), not the OS. Null until known. */
  customTitleBar: boolean | null;
  setCustomTitleBar: (on: boolean) => void;
  setAbout: (open: boolean) => void;
  /** Keys opened lately on this connection, newest first. */
  recent: string[];
  /** Keys pinned on this connection, in the order they were pinned. */
  pins: string[];
  /** Seconds between automatic re-reads of the open key; 0 is off. */
  refreshEvery: number;
  setRefreshEvery: (seconds: number) => void;
  togglePin: (name: string) => void;
  /** Selects a key and opens the folders above it so the tree shows it. */
  reveal: (name: string) => void;
  /** True while the app reconnects to the last session at launch. */
  resuming: boolean;
  /** Why the automatic reconnect failed, shown on the connections screen. */
  launchError: string | null;
  setResuming: (resuming: boolean) => void;
  setLaunchError: (message: string | null) => void;
  /** Puts back the folders, key and search of a saved session. */
  restore: (session: Session) => void;
  /** Starts browsing `info`. `id` is the profile it came from; omit it to keep the current one. */
  setConnected: (info: ConnectionInfo | null, id?: string) => void;
  /** Opens the connections screen without dropping the live connection. */
  openConnections: () => void;
  /** Goes back to browsing the live connection, with its state intact. */
  resume: () => void;
  edit: (id: string | null) => void;
  setView: (view: "keys" | "server") => void;
  select: (name: string | null) => void;
  setFilter: (value: string) => void;
  toggle: (path: string) => void;
}

export const useUi = create<UiState>((set) => ({
  delimiter: loadDelimiter(),
  setDelimiter: (delimiter) => {
    try {
      localStorage.setItem(DELIMITER_KEY, delimiter);
    } catch {
      // Not persisting is fine; the choice still applies for this session.
    }
    set({ delimiter, expanded: new Set() });
  },
  connected: null,
  connectedId: null,
  quickOpen: false,
  // Quick open searches keys, which a SQL connection doesn't have.
  setQuickOpen: (quickOpen) =>
    set((s) => ({ quickOpen: quickOpen && s.connected?.store !== "sql" })),
  customTitleBar: null,
  setCustomTitleBar: (customTitleBar) => set({ customTitleBar }),
  about: false,
  setAbout: (about) => set({ about }),
  recent: [],
  pins: [],
  refreshEvery: loadRefresh(),
  setRefreshEvery: (refreshEvery) => {
    saveRefresh(refreshEvery);
    set({ refreshEvery });
  },
  togglePin: (name) =>
    set((s) => {
      const pins = togglePin(s.pins, name);
      if (s.connectedId) savePins(s.connectedId, pins);
      return { pins };
    }),
  reveal: (name) =>
    set((s) => ({
      selected: name,
      view: "keys",
      recent: remember(s, name),
      expanded: new Set([...s.expanded, ...ancestorsOf(name, s.delimiter)]),
    })),
  // A saved session means the last launch ended while browsing.
  resuming: loadSession() !== null,
  launchError: null,
  setResuming: (resuming) => set({ resuming }),
  setLaunchError: (launchError) => set({ launchError }),
  restore: (session) =>
    set({
      expanded: new Set(session.expanded),
      selected: session.selected,
      filter: session.filter,
      sqlSchema: session.schema,
      sqlTable: session.table,
    }),
  picking: false,
  editing: null,
  view: "keys",
  selected: null,
  filter: "",
  sqlSchema: null,
  sqlTable: null,
  sqlTab: "data",
  sqlOffset: 0,
  sqlFilter: "",
  sqlSort: null,
  sqlPinned: [],
  sqlQueryOpen: false,
  sqlText: "",
  openQueryEditor: () => set({ sqlQueryOpen: true }),
  setSqlText: (sqlText) => set({ sqlText }),
  // Changing database keeps the editor open, so a query can be tried on another one.
  selectSchema: (sqlSchema) =>
    set({
      sqlSchema,
      sqlTable: null,
      sqlTab: "data",
      sqlOffset: 0,
      sqlFilter: "",
      sqlSort: null,
      sqlPinned: [],
    }),
  // Picking a table, or going back up to the database, leaves the editor.
  selectTable: (sqlTable) =>
    set({
      sqlTable,
      sqlTab: "data",
      sqlOffset: 0,
      sqlFilter: "",
      sqlSort: null,
      sqlPinned: [],
      sqlQueryOpen: false,
    }),
  setSqlTab: (sqlTab) => set({ sqlTab }),
  setSqlOffset: (sqlOffset) => set({ sqlOffset: Math.max(0, sqlOffset) }),
  setSqlFilter: (sqlFilter) => set({ sqlFilter, sqlOffset: 0 }),
  setSqlSort: (sqlSort) => set({ sqlSort, sqlOffset: 0 }),
  togglePinnedColumn: (column) =>
    set((s) => ({ sqlPinned: toggleColumnPin(s.sqlPinned, column) })),
  kindFilter: null,
  setKindFilter: (kindFilter) => set({ kindFilter }),
  sort: "name",
  setSort: (sort) => set({ sort }),
  expanded: new Set(),
  // Browsing state belongs to one connection, so it resets with it.
  setConnected: (connected, id) =>
    set((s) => {
      const connectedId = connected === null ? null : (id ?? s.connectedId);
      return {
        connected,
        connectedId,
        recent: connectedId ? loadRecent(connectedId) : [],
        pins: connectedId ? loadPins(connectedId) : [],
        quickOpen: false,
        picking: false,
        launchError: null,
        selected: null,
        filter: "",
        sqlSchema: null,
        sqlTable: null,
        sqlTab: "data",
        sqlOffset: 0,
        sqlFilter: "",
        sqlSort: null,
        sqlPinned: [],
        sqlQueryOpen: false,
        sqlText: "",
        kindFilter: null,
        sort: "name",
        expanded: new Set(),
        editing: null,
      };
    }),
  openConnections: () => set({ picking: true, editing: null }),
  resume: () => set({ picking: false, editing: null }),
  edit: (editing) => set({ editing }),
  setView: (view) => set({ view }),
  select: (selected) =>
    set((s) => ({ selected, view: "keys", recent: remember(s, selected) })),
  setFilter: (filter) => set({ filter }),
  toggle: (path) =>
    set((s) => {
      const next = new Set(s.expanded);
      if (!next.delete(path)) next.add(path);
      return { expanded: next };
    }),
}));
