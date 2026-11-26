import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canHide,
  liveHidden,
  loadHidden,
  matchColumns,
  saveHidden,
  shownIndexes,
  toggleHidden,
} from "./hiddenColumns";

let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});

describe("saving and loading", () => {
  it("keeps the hidden names per connection, schema and table", () => {
    saveHidden("p1", "shop", "orders", ["notes", "meta"]);
    expect(loadHidden("p1", "shop", "orders")).toEqual(["notes", "meta"]);
    expect(loadHidden("p1", "shop", "customers")).toEqual([]);
    expect(loadHidden("p1", "other", "orders")).toEqual([]);
    expect(loadHidden("p2", "shop", "orders")).toEqual([]);
  });
  it("keeps tables whose names contain dots apart", () => {
    saveHidden("p1", "a.b", "c", ["x"]);
    expect(loadHidden("p1", "a", "b.c")).toEqual([]);
    expect(loadHidden("p1", "a.b", "c")).toEqual(["x"]);
  });
  it("removes the entry when nothing is hidden", () => {
    saveHidden("p1", "shop", "orders", ["notes"]);
    saveHidden("p1", "shop", "orders", []);
    expect(data.size).toBe(0);
  });
  it("reads nothing bad from a damaged value", () => {
    const key = [
      ...(saveHidden("p1", "shop", "orders", ["x"]), data.keys()),
    ][0];
    data.set(key, "{not json");
    expect(loadHidden("p1", "shop", "orders")).toEqual([]);
    data.set(key, '{"a":1}');
    expect(loadHidden("p1", "shop", "orders")).toEqual([]);
    data.set(key, '["a", 3, null, "a", "b"]');
    expect(loadHidden("p1", "shop", "orders")).toEqual(["a", "b"]);
  });
  it("works when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadHidden("p1", "s", "t")).toEqual([]);
    expect(() => saveHidden("p1", "s", "t", ["a"])).not.toThrow();
  });
});

describe("liveHidden", () => {
  it("drops names the table no longer has", () => {
    expect(liveHidden(["a", "gone"], ["a", "b"])).toEqual(["a"]);
  });
  it("hides nothing when it would hide everything", () => {
    expect(liveHidden(["a", "b"], ["a", "b"])).toEqual([]);
    expect(liveHidden(["a", "b", "gone"], ["a", "b"])).toEqual([]);
  });
});

describe("canHide", () => {
  const names = ["id", "name", "notes"];
  it("allows an ordinary column", () => {
    expect(canHide(names, [], [], "notes")).toBe(true);
  });
  it("refuses a pinned column", () => {
    expect(canHide(names, [], ["id"], "id")).toBe(false);
  });
  it("refuses the last column that shows", () => {
    expect(canHide(names, ["id", "name"], [], "notes")).toBe(false);
  });
  it("always allows showing a hidden column again", () => {
    expect(canHide(names, ["id", "name"], ["id"], "id")).toBe(true);
  });
});

describe("toggleHidden", () => {
  it("adds and removes", () => {
    expect(toggleHidden([], "a")).toEqual(["a"]);
    expect(toggleHidden(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("shownIndexes", () => {
  it("keeps table order and leaves out the hidden", () => {
    expect(shownIndexes(["a", "b", "c", "d"], ["b", "d"])).toEqual([0, 2]);
    expect(shownIndexes(["a", "b"], [])).toEqual([0, 1]);
  });
});

describe("matchColumns", () => {
  const cols = [{ name: "Created_at" }, { name: "id" }, { name: "creator" }];
  it("matches part of a name, ignoring case", () => {
    expect(matchColumns(cols, "CREAT").map((c) => c.name)).toEqual([
      "Created_at",
      "creator",
    ]);
  });
  it("keeps everything for a blank term", () => {
    expect(matchColumns(cols, "  ")).toHaveLength(3);
  });
});
