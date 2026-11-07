import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatStreamTime,
  databaseChoices,
  formatTtl,
  remainingTtl,
  formatUptime,
  hitRate,
  formatTtlShort,
  hexDump,
  tryPrettyJson,
  typeBadge,
} from "./format";

describe("formatTtl", () => {
  it("reads naturally at each scale", () => {
    expect(formatTtl(null)).toBe("No expiry");
    expect(formatTtl(45)).toBe("45s");
    expect(formatTtl(120)).toBe("2m");
    expect(formatTtl(125)).toBe("2m 5s");
    expect(formatTtl(3600)).toBe("1h");
    expect(formatTtl(5400)).toBe("1h 30m");
    expect(formatTtl(90000)).toBe("1d 1h");
  });
  it("shortens to one unit for tree rows", () => {
    expect(formatTtlShort(30)).toBe("30s");
    expect(formatTtlShort(3600)).toBe("1h");
    expect(formatTtlShort(172800)).toBe("2d");
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});

describe("typeBadge", () => {
  it("abbreviates known types and falls back for others", () => {
    expect(typeBadge("string")).toBe("STR");
    expect(typeBadge("ReJSON-RL")).toBe("REJS");
  });
});

describe("tryPrettyJson", () => {
  it("formats objects and arrays only", () => {
    expect(tryPrettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(tryPrettyJson("42")).toBeNull();
    expect(tryPrettyJson("{broken")).toBeNull();
  });
});

describe("hexDump", () => {
  it("shows offset, bytes and ascii", () => {
    expect(hexDump("68690a")).toBe(`000000  ${"68 69 0a".padEnd(47)}  hi.`);
  });
});

describe("formatStreamTime", () => {
  it("formats local time and tolerates missing or absurd values", () => {
    const ms = new Date(2026, 10, 5, 14, 20, 1).getTime();
    expect(formatStreamTime(ms)).toBe("2026-11-05 14:20:01");
    expect(formatStreamTime(null)).toBe("—");
    expect(formatStreamTime(Number.MAX_SAFE_INTEGER)).toBe("—");
  });
});

describe("formatUptime", () => {
  it("shows the two largest units", () => {
    expect(formatUptime(42)).toBe("42s");
    expect(formatUptime(125)).toBe("2m 5s");
    expect(formatUptime(3 * 3600 + 120)).toBe("3h 2m");
    expect(formatUptime(3 * 86400 + 4 * 3600 + 59)).toBe("3d 4h");
  });
});

describe("hitRate", () => {
  it("is null with no lookups and a fraction otherwise", () => {
    expect(hitRate(0, 0)).toBeNull();
    expect(hitRate(null, 5)).toBeNull();
    expect(hitRate(3, 1)).toBe(0.75);
  });
});

describe("databaseChoices", () => {
  it("offers 0-15 plus extras and the current database, sorted and unique", () => {
    const c = databaseChoices([3, 40], 99);
    expect(c.slice(0, 3)).toEqual([0, 1, 2]);
    expect(c.filter((n) => n === 3)).toHaveLength(1);
    expect(c.slice(-2)).toEqual([40, 99]);
    expect(c).toHaveLength(18);
  });
});

describe("remainingTtl", () => {
  it("counts down from when the TTL was read", () => {
    expect(remainingTtl(90, 1000, 1000)).toBe(90);
    expect(remainingTtl(90, 1000, 31_000)).toBe(60);
  });
  it("stops at zero and keeps no-expiry as null", () => {
    expect(remainingTtl(5, 0, 60_000)).toBe(0);
    expect(remainingTtl(null, 0, 60_000)).toBeNull();
  });
});
