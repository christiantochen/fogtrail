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
  ttlLabel,
  memoryUsage,
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
  it("lists every database when the server says how many it has", () => {
    expect(databaseChoices([0], 0, 16)).toHaveLength(16);
    expect(databaseChoices([0], 0, 4)).toEqual([0, 1, 2, 3]);
  });
  it("lists only databases with keys when the server will not say", () => {
    expect(databaseChoices([3, 0], 0, null)).toEqual([0, 3]);
    expect(databaseChoices([], 0, null)).toEqual([0]);
  });
  it("always includes the current database", () => {
    expect(databaseChoices([0], 7, 4)).toEqual([0, 1, 2, 3, 7]);
    expect(databaseChoices([0], 2, null)).toEqual([0, 2]);
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

describe("ttlLabel", () => {
  it("counts down from the scan, one unit, then says expired", () => {
    const t0 = 1_000_000;
    expect(ttlLabel(600, t0, t0)).toEqual({ text: "10m", expired: false });
    expect(ttlLabel(600, t0, t0 + 570_000)).toEqual({
      text: "30s",
      expired: false,
    });
    expect(ttlLabel(600, t0, t0 + 600_000)).toEqual({
      text: "expired",
      expired: true,
    });
    expect(ttlLabel(600, t0, t0 + 9_999_000)?.expired).toBe(true);
  });
  it("shows nothing without a TTL and ignores a clock that is behind", () => {
    expect(ttlLabel(null, 0, 5000)).toBeNull();
    expect(ttlLabel(90, 10_000, 0)).toEqual({ text: "2m", expired: false });
  });
});

describe("memoryUsage", () => {
  it("is a percentage with a level", () => {
    expect(memoryUsage(12_300_000, 30_000_000)).toEqual({
      percent: 41,
      level: "ok",
    });
    expect(memoryUsage(80, 100)?.level).toBe("ok");
    expect(memoryUsage(81, 100)?.level).toBe("warn");
    expect(memoryUsage(95, 100)?.level).toBe("warn");
    expect(memoryUsage(96, 100)?.level).toBe("bad");
  });
  it("never goes past 100", () => {
    expect(memoryUsage(150, 100)).toEqual({ percent: 100, level: "bad" });
  });
  it("has nothing to compare to without a limit", () => {
    expect(memoryUsage(10, 0)).toBeNull();
    expect(memoryUsage(10, null)).toBeNull();
    expect(memoryUsage(null, 100)).toBeNull();
  });
});
