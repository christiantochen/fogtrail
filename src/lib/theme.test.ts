import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadTheme, parseTheme, resolveTheme, saveTheme } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
  });

  it("knows light, dark and system, and treats anything else as system", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
    for (const bad of [null, undefined, "", "Dark", "blue", 3, {}])
      expect(parseTheme(bad)).toBe("system");
  });

  it("starts as system and remembers the pick", () => {
    expect(loadTheme()).toBe("system");
    saveTheme("dark");
    expect(loadTheme()).toBe("dark");
    saveTheme("system");
    expect(loadTheme()).toBe("system");
  });

  it("copes with storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadTheme()).toBe("system");
    expect(() => saveTheme("dark")).not.toThrow();
  });

  it("ignores a saved value it doesn't know", () => {
    localStorage.setItem("fogtrail.theme", "purple");
    expect(loadTheme()).toBe("system");
  });

  it("follows the OS only for system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
