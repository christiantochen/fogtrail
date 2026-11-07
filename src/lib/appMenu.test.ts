import { describe, expect, it } from "vitest";
import { MENUS, mnemonicIndex, shortcutFor } from "./appMenu";

const key = (k: string, mods: Partial<Record<string, boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe("shortcutFor", () => {
  it("maps the native menu accelerators", () => {
    expect(shortcutFor(key("n", { ctrlKey: true }))).toBe("new-connection");
    expect(shortcutFor(key("f", { ctrlKey: true }))).toBe("search");
    expect(shortcutFor(key("r", { ctrlKey: true }))).toBe("refresh");
    expect(shortcutFor(key("i", { ctrlKey: true }))).toBe("server-info");
    expect(shortcutFor(key("O", { ctrlKey: true, shiftKey: true }))).toBe(
      "connections",
    );
    expect(shortcutFor(key("F11"))).toBe("win:fullscreen");
  });
  it("leaves shortcuts handled elsewhere alone", () => {
    expect(shortcutFor(key("k", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("f", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(shortcutFor(key("c", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
  it("ignores plain typing and Alt chords", () => {
    expect(shortcutFor(key("n"))).toBeNull();
    expect(shortcutFor(key("f", { ctrlKey: true, altKey: true }))).toBeNull();
  });
});

describe("mnemonicIndex", () => {
  it("finds the menu for Alt+letter", () => {
    expect(mnemonicIndex(key("f", { altKey: true }))).toBe(0);
    expect(mnemonicIndex(key("H", { altKey: true }))).toBe(4);
  });
  it("needs Alt and nothing else", () => {
    expect(mnemonicIndex(key("f"))).toBe(-1);
    expect(mnemonicIndex(key("f", { altKey: true, ctrlKey: true }))).toBe(-1);
    expect(mnemonicIndex(key("z", { altKey: true }))).toBe(-1);
  });
});

describe("MENUS", () => {
  it("has unique mnemonics and ids", () => {
    const m = MENUS.map((x) => x.mnemonic);
    expect(new Set(m).size).toBe(m.length);
    const ids = MENUS.flatMap((x) =>
      x.items.filter((i) => i !== "-").map((i) => (i as { id: string }).id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});
