import readme from "../../README.md?raw";
import { describe, expect, it } from "vitest";
import {
  AREAS,
  README_END,
  README_START,
  SHORTCUTS,
  type Shortcut,
  areasFor,
  clashes,
  keyLabel,
  readmeKeys,
  readmeTable,
  shortcutsOf,
} from "./shortcuts";

/** Cells trimmed and padding dropped, so the README can be lined up by Prettier. */
const cells = (table: string) =>
  table
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .map((l) =>
      l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim().replace(/^-+$/, "---"))
        .join("|"),
    );

describe("the shortcuts list", () => {
  it("has no two shortcuts on the same key in one area", () => {
    expect(clashes()).toEqual([]);
  });
  it("notices a clash", () => {
    const sc = (area: Shortcut["area"], label: string, keys: string[]) => ({
      area,
      label,
      keys,
    });
    const a = sc("tables", "A", ["mod", "K"]);
    const b = sc("tables", "B", ["mod", "K"]);
    const c = sc("rows", "C", ["mod", "K"]);
    expect(clashes([a, c])).toEqual([]);
    expect(clashes([a, b])).toHaveLength(1);
    const x = { ...sc("tables", "X", ["up", "down"]), either: true };
    expect(clashes([x, sc("tables", "Y", ["down"])])).toHaveLength(1);
  });
  it("gives every shortcut a label and a known area", () => {
    const ids = AREAS.map((a) => a.id);
    for (const s of SHORTCUTS) {
      expect(s.label.trim()).not.toBe("");
      expect(s.keys.length).toBeGreaterThan(0);
      expect(ids).toContain(s.area);
    }
    for (const a of AREAS) expect(shortcutsOf(a.id).length).toBeGreaterThan(0);
  });
  it("shows Everywhere plus the groups for the connection", () => {
    const ids = (s: "sql" | "keyValue" | null) => areasFor(s).map((a) => a.id);
    expect(ids(null)).toEqual(["everywhere"]);
    expect(ids("sql")).toEqual(["everywhere", "tables", "rows", "editor"]);
    expect(ids("keyValue")).toEqual(["everywhere", "keys"]);
  });
});

describe("key labels", () => {
  it("uses symbols on a Mac and names on Windows", () => {
    expect(keyLabel("mod", true)).toBe("⌘");
    expect(keyLabel("mod", false)).toBe("Ctrl");
    expect(keyLabel("shift", true)).toBe("⇧");
    expect(keyLabel("enter", true)).toBe("↵");
    expect(keyLabel("enter", false)).toBe("Enter");
    expect(keyLabel("K", true)).toBe("K");
    expect(keyLabel("up", false)).toBe("↑");
  });
  it("writes the README form", () => {
    const find = (label: string) => SHORTCUTS.find((s) => s.label === label)!;
    expect(readmeKeys(find("Back to connections"))).toBe(
      "Shift + Cmd/Ctrl + O",
    );
    expect(readmeKeys(find("Move through keys"))).toBe("↑ / ↓");
  });
});

describe("the README", () => {
  it("lists exactly the shortcuts in the list", () => {
    const from = readme.indexOf(README_START);
    const to = readme.indexOf(README_END);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const block = readme.slice(from + README_START.length, to);
    expect(cells(block)).toEqual(cells(readmeTable()));
  });
});
