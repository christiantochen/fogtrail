import { describe, expect, it } from "vitest";
import { findRanges, MAX_HITS, piecesOf, stepHit } from "./find";

describe("findRanges", () => {
  it("finds every match ignoring case", () => {
    expect(findRanges("Foo foo FOO", "foo")).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
  });
  it("does not overlap and treats an empty term as nothing", () => {
    expect(findRanges("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(findRanges("abc", "")).toEqual([]);
  });
  it("stops counting at a cap", () => {
    expect(findRanges("a".repeat(MAX_HITS + 50), "a")).toHaveLength(MAX_HITS);
  });
});

describe("piecesOf", () => {
  it("marks the matches and keeps all the text", () => {
    const text = "a foo b";
    const p = piecesOf(text, 0, findRanges(text, "foo"));
    expect(p).toEqual([
      { text: "a ", hit: null },
      { text: "foo", hit: 0 },
      { text: " b", hit: null },
    ]);
  });
  it("splits a match that crosses pieces, under one index", () => {
    const whole = '"k": 1';
    const ranges = findRanges(whole, 'k": 1');
    const a = piecesOf('"k"', 0, ranges);
    const b = piecesOf(": 1", 3, ranges);
    expect(a.map((x) => x.hit)).toEqual([null, 0]);
    expect(b.map((x) => x.hit)).toEqual([0]);
    expect([...a, ...b].map((x) => x.text).join("")).toBe(whole);
  });
});

describe("stepHit", () => {
  it("wraps both ways", () => {
    expect(stepHit(2, 3)).toBe(0);
    expect(stepHit(0, 3, true)).toBe(2);
    expect(stepHit(0, 0)).toBe(0);
  });
});
