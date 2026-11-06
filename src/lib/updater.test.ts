import { describe, expect, it } from "vitest";
import { percent } from "./updater";

describe("percent", () => {
  it("rounds progress and caps it at 100", () => {
    expect(percent(0, 200)).toBe(0);
    expect(percent(50, 200)).toBe(25);
    expect(percent(201, 200)).toBe(100);
  });
  it("is unknown without a total size", () => {
    expect(percent(50, null)).toBeNull();
    expect(percent(50, 0)).toBeNull();
  });
});
