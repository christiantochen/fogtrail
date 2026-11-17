import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadRecentTables, pushRecent, pushRecentTable } from "./recent";

describe("pushRecent", () => {
  it("puts the newest first and drops repeats", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent([], "a")).toEqual(["a"]);
  });
  it("keeps only the newest few", () => {
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("recent tables", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
  });
  const t = (schema: string, table: string) => ({ schema, table });
  it("puts the newest first and tells schemas apart", () => {
    const list = [t("public", "orders"), t("billing", "orders")];
    expect(pushRecentTable(list, t("billing", "orders"))).toEqual([
      t("billing", "orders"),
      t("public", "orders"),
    ]);
    expect(pushRecentTable(list, t("archive", "orders"), 2)).toEqual([
      t("archive", "orders"),
      t("public", "orders"),
    ]);
  });
  it("loads only well-formed entries, and nothing for a broken value", () => {
    localStorage.setItem(
      "fogtrail.recentTables.p1",
      JSON.stringify([t("a", "b"), { schema: 1 }, "x", null]),
    );
    expect(loadRecentTables("p1")).toEqual([t("a", "b")]);
    localStorage.setItem("fogtrail.recentTables.p2", "{not json");
    expect(loadRecentTables("p2")).toEqual([]);
    expect(loadRecentTables("missing")).toEqual([]);
  });
});
