import { describe, expect, it } from "vitest";
import { MAX_HITS } from "./find";
import { findInRow, hitsLabel, placeOf } from "./rowFind";

const columns = [
  { name: "id" },
  { name: "tax_type" },
  { name: "tax" },
  { name: "city" },
  { name: "items" },
];
const row = ["1", null, "10", "Taxila", '[{"tax_rate": 0.09}]'];
const json = [
  {
    index: 4,
    pretty: '[\n  {\n    "tax_rate": 0.09\n  }\n]',
    source: "json" as const,
  },
];

describe("findInRow", () => {
  it("finds names and values in plain columns, ignoring case, then JSON", () => {
    const h = findInRow(columns, row, [0, 1, 2, 3], json, "tax");
    // tax_type (name), tax (name), city "Taxila" (value), then the JSON key.
    expect(
      h.fields.map((f) => [f.index, f.name.length, f.value.length]),
    ).toEqual([
      [1, 1, 0],
      [2, 1, 0],
      [3, 0, 1],
    ]);
    const at = json[0].pretty.indexOf("tax");
    expect(h.json).toEqual([{ index: 4, ranges: [[at, at + 3]] }]);
    expect(h.total).toBe(4);
  });

  it("searches NULL as text, so typing null finds NULL cells", () => {
    const h = findInRow(columns, row, [1], [], "null");
    expect(h.fields).toEqual([{ index: 1, name: [], value: [[0, 4]] }]);
  });

  it("finds nothing for an empty term, and for no match", () => {
    expect(findInRow(columns, row, [0, 1], json, "").total).toBe(0);
    expect(findInRow(columns, row, [0, 1], json, "zzz").total).toBe(0);
  });

  it("stops counting at the cap", () => {
    const many = [{ name: "x" }];
    const h = findInRow(many, ["a".repeat(MAX_HITS + 50)], [0], [], "a");
    expect(h.total).toBe(MAX_HITS);
  });
});

describe("placeOf", () => {
  const h = findInRow(columns, row, [0, 1, 2, 3], json, "tax");
  it("walks the matches in reading order", () => {
    expect(placeOf(h, 0)).toEqual({ kind: "name", index: 1, local: 0 });
    expect(placeOf(h, 1)).toEqual({ kind: "name", index: 2, local: 0 });
    expect(placeOf(h, 2)).toEqual({ kind: "value", index: 3, local: 0 });
    expect(placeOf(h, 3)).toEqual({ kind: "json", index: 4, local: 0 });
  });
  it("is null outside the range", () => {
    expect(placeOf(h, 4)).toBeNull();
    expect(placeOf(h, -1)).toBeNull();
  });
});

describe("hitsLabel", () => {
  it("reads as a position, no matches, or a capped count", () => {
    expect(hitsLabel(7, 0)).toBe("1 of 7");
    expect(hitsLabel(0, 0)).toBe("No matches");
    expect(hitsLabel(MAX_HITS, 3)).toBe(`${MAX_HITS}+ matches`);
  });
});
