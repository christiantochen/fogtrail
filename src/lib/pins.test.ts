import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPins, savePins, togglePin } from "./pins";

describe("togglePin", () => {
  it("adds at the end and removes on the second call", () => {
    expect(togglePin(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePin(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("pins storage", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
  });
  it("keeps pins per connection", () => {
    savePins("1", ["x"]);
    expect(loadPins("1")).toEqual(["x"]);
    expect(loadPins("2")).toEqual([]);
  });
  it("ignores damaged data", () => {
    localStorage.setItem("fogtrail.pins.1", "{nope");
    expect(loadPins("1")).toEqual([]);
    localStorage.setItem("fogtrail.pins.1", '["a", 3, null]');
    expect(loadPins("1")).toEqual(["a"]);
  });
});
