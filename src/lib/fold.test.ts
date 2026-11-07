import { describe, expect, it } from "vitest";
import { collapseAll, lineAt, parseBlocks, summaryOf, unfoldFor } from "./fold";

const text = JSON.stringify(
  { id: 9, items: [{ sku: "A", qty: 1 }, { sku: "B" }], tags: [], note: "x" },
  null,
  2,
);
// 0 {
// 1   "id": 9,
// 2   "items": [
// 3     {
// 4       "sku": "A",
// 5       "qty": 1
// 6     },
// 7     {
// 8       "sku": "B"
// 9     }
// 10   ],
// 11   "tags": [],
// 12   "note": "x"
// 13 }

describe("parseBlocks", () => {
  const blocks = parseBlocks(text);
  it("finds every multi-line block, outermost first", () => {
    expect(blocks.map((b) => [b.start, b.end])).toEqual([
      [0, 13],
      [2, 10],
      [3, 6],
      [7, 9],
    ]);
  });
  it("counts direct children only", () => {
    expect(blocks.map((b) => b.count)).toEqual([4, 2, 2, 1]);
  });
  it("skips empty one-line blocks", () => {
    expect(blocks.some((b) => b.start === 11)).toBe(false);
  });
  it("ignores brackets inside strings", () => {
    const t = JSON.stringify({ s: "{[", t: "]}" }, null, 2);
    expect(parseBlocks(t)).toHaveLength(1);
  });
});

describe("summaryOf", () => {
  it("uses fields for objects and items for arrays", () => {
    const [root, items] = parseBlocks(text);
    expect(summaryOf(root)).toBe("4 fields");
    expect(summaryOf(items)).toBe("2 items");
    expect(summaryOf({ ...items, count: 1 })).toBe("1 item");
  });
});

describe("lineAt", () => {
  it("maps an offset to its line", () => {
    expect(lineAt("a\nbb\nc", 0)).toBe(0);
    expect(lineAt("a\nbb\nc", 3)).toBe(1);
    expect(lineAt("a\nbb\nc", 5)).toBe(2);
  });
});

describe("unfoldFor", () => {
  const blocks = parseBlocks(text);
  it("opens the blocks that hide the line, and only those", () => {
    const next = unfoldFor(new Set([2, 3, 7]), blocks, 4);
    expect([...next]).toEqual([7]);
  });
  it("keeps a block closed when the hit is on its own opening line", () => {
    expect(unfoldFor(new Set([3]), blocks, 3).has(3)).toBe(true);
  });
});

describe("collapseAll", () => {
  it("folds everything but the outermost block", () => {
    expect([...collapseAll(parseBlocks(text))]).toEqual([2, 3, 7]);
  });
});
