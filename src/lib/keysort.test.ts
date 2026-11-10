import { describe, expect, it } from "vitest";
import type { KeyNode } from "../api/types";
import { sortByExpiry } from "./keysort";
import { flatNodes } from "./tree";

const k = (
  name: string,
  ttlSeconds: number | null,
  scannedAt = 0,
): KeyNode => ({
  name,
  kind: "string",
  ttlSeconds,
  scannedAt,
});

describe("sortByExpiry", () => {
  it("lists keys with a TTL, soonest first, and drops the rest", () => {
    const out = sortByExpiry([
      k("b", 300),
      k("none", null),
      k("a", 30),
      k("c", 90),
    ]);
    expect(out.map((x) => x.name)).toEqual(["a", "c", "b"]);
  });
  it("goes by when each TTL was read, not just its length", () => {
    // "old" had 100 s left but was read 90 s earlier, so it runs out first.
    const out = sortByExpiry([k("new", 50, 100_000), k("old", 100, 10_000)]);
    expect(out.map((x) => x.name)).toEqual(["old", "new"]);
  });
  it("breaks ties by name and does not change its input", () => {
    const input = [k("z", 10), k("a", 10)];
    expect(sortByExpiry(input).map((x) => x.name)).toEqual(["a", "z"]);
    expect(input.map((x) => x.name)).toEqual(["z", "a"]);
  });
});

describe("flatNodes", () => {
  it("gives one row per key, in the order given", () => {
    const rows = flatNodes([k("b:1", null), k("a", null)]);
    expect(rows.map((r) => r.label)).toEqual(["b:1", "a"]);
    expect(rows.every((r) => r.children.length === 0 && r.key)).toBe(true);
  });
});
