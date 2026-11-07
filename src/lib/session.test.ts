import { describe, expect, it } from "vitest";
import { parseSession } from "./session";

describe("parseSession", () => {
  it("reads a complete session", () => {
    const raw = JSON.stringify({
      profileId: "1",
      database: 2,
      expanded: ["shop", "shop:cart"],
      selected: "shop:cart:1",
      filter: "cart",
    });
    expect(parseSession(raw)).toEqual({
      profileId: "1",
      database: 2,
      expanded: ["shop", "shop:cart"],
      selected: "shop:cart:1",
      filter: "cart",
    });
  });

  it("fills in what is missing and drops what is the wrong type", () => {
    expect(
      parseSession(JSON.stringify({ profileId: "1", expanded: ["a", 5] })),
    ).toEqual({
      profileId: "1",
      database: 0,
      expanded: ["a"],
      selected: null,
      filter: "",
    });
  });

  it("is null for nothing, junk, or no connection", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("not json")).toBeNull();
    expect(parseSession("{}")).toBeNull();
    expect(parseSession(JSON.stringify({ profileId: "" }))).toBeNull();
  });
});
