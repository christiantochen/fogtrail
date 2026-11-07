import { describe, expect, it } from "vitest";
import { pushRecent } from "./recent";

describe("pushRecent", () => {
  it("puts the newest first and drops repeats", () => {
    expect(pushRecent(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
    expect(pushRecent([], "a")).toEqual(["a"]);
  });
  it("keeps only the newest few", () => {
    expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});
