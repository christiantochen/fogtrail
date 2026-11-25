import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clockLabel,
  DEFAULT_PAGE_SIZE,
  loadPageSize,
  savePageSize,
  validPageSize,
} from "./pageSize";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
});

describe("validPageSize", () => {
  it("keeps the sizes we offer", () => {
    expect(validPageSize(100)).toBe(100);
    expect(validPageSize(250)).toBe(250);
    expect(validPageSize(500)).toBe(500);
  });
  it("falls back to the default for anything else", () => {
    expect(validPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(validPageSize(1000)).toBe(DEFAULT_PAGE_SIZE);
    expect(validPageSize("250")).toBe(DEFAULT_PAGE_SIZE);
    expect(validPageSize(NaN)).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("saved page size", () => {
  it("is remembered per connection", () => {
    savePageSize("a", 500);
    savePageSize("b", 250);
    expect(loadPageSize("a")).toBe(500);
    expect(loadPageSize("b")).toBe(250);
    expect(loadPageSize("c")).toBe(DEFAULT_PAGE_SIZE);
  });
  it("saves only a size we offer", () => {
    savePageSize("a", 1000);
    expect(localStorage.getItem("fogtrail.pageSize.a")).toBe("100");
  });
  it("falls back to the default for a stored value that is not a number", () => {
    localStorage.setItem("fogtrail.pageSize.a", "abc");
    expect(loadPageSize("a")).toBe(DEFAULT_PAGE_SIZE);
    localStorage.setItem("fogtrail.pageSize.a", "");
    expect(loadPageSize("a")).toBe(DEFAULT_PAGE_SIZE);
  });
  it("ignores a value that was edited to something we do not offer", () => {
    localStorage.setItem("fogtrail.pageSize.a", "99999");
    expect(loadPageSize("a")).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("when storage is not available", () => {
  it("loads the default and does not throw on save", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadPageSize("a")).toBe(DEFAULT_PAGE_SIZE);
    expect(() => savePageSize("a", 250)).not.toThrow();
  });
});

describe("clockLabel", () => {
  it("pads hours, minutes and seconds", () => {
    expect(clockLabel(new Date(2026, 10, 26, 4, 5, 6).getTime())).toBe(
      "04:05:06",
    );
    expect(clockLabel(new Date(2026, 10, 26, 14, 32, 5).getTime())).toBe(
      "14:32:05",
    );
  });
});
