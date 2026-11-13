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
  it("finds names and values in column order, ignoring case, and counts a JSON column once", () => {
    const h = findInRow(columns, row, json, "tax");
    // tax_type (name), tax (name), city "Taxila" (value), items (JSON, one match inside).
    expect(
      h.fields.map((f) => [f.index, f.name.length, f.value.length, f.json]),
    ).toEqual([
      [1, 1, 0, 0],
      [2, 1, 0, 0],
      [3, 0, 1, 0],
      [4, 0, 0, 1],
    ]);
    expect(h.total).toBe(4);
  });

  it("counts every match inside a JSON value as one hit for its column", () => {
    const two = [
      { index: 4, pretty: '{"a": "zz", "b": "zz"}', source: "json" as const },
    ];
    const h = findInRow(columns, row, two, "zz");
    expect(h.fields).toEqual([{ index: 4, name: [], value: [], json: 2 }]);
    expect(h.total).toBe(1);
  });

  it("matches a null cell only for the whole word, in any case", () => {
    expect(findInRow(columns, row, [], "null").fields).toEqual([
      { index: 1, name: [], value: [[0, 4]], json: 0 },
    ]);
    expect(findInRow(columns, row, [], "NULL").total).toBe(1);
    // A part of the word never matches.
    expect(findInRow(columns, row, [], "nu").total).toBe(0);
    expect(findInRow(columns, row, [], "ull").total).toBe(0);
  });

  it("finds nothing for an empty term, and for no match", () => {
    expect(findInRow(columns, row, json, "").total).toBe(0);
    expect(findInRow(columns, row, json, "zzz").total).toBe(0);
  });

  it("stops counting at the cap", () => {
    const h = findInRow([{ name: "x" }], ["a".repeat(MAX_HITS + 50)], [], "a");
    expect(h.total).toBe(MAX_HITS);
  });
});

describe("placeOf", () => {
  const h = findInRow(columns, row, json, "tax");
  it("walks the matches in column order", () => {
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
