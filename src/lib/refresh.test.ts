import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatAgo, freshEntries, loadRefresh, saveRefresh } from "./refresh";

describe("refresh setting", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
  });
  it("is off until chosen, then remembered", () => {
    expect(loadRefresh()).toBe(0);
    saveRefresh(5);
    expect(loadRefresh()).toBe(5);
  });
  it("ignores values that are not on offer", () => {
    saveRefresh(7);
    expect(loadRefresh()).toBe(0);
  });
});

describe("formatAgo", () => {
  it("reads naturally at each scale", () => {
    expect(formatAgo(0)).toBe("just now");
    expect(formatAgo(2)).toBe("2s ago");
    expect(formatAgo(125)).toBe("2m ago");
    expect(formatAgo(7300)).toBe("2h ago");
  });
});

describe("freshEntries", () => {
  it("returns only what is new", () => {
    expect([...freshEntries(["a", "b"], ["a", "c"])]).toEqual(["c"]);
    expect(freshEntries(["a"], ["a"]).size).toBe(0);
  });
});
