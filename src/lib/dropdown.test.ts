import { describe, expect, it } from "vitest";
import { listPlacement, moveActive, typeahead } from "./dropdown";

describe("moveActive", () => {
  it("moves by one and stops at the ends", () => {
    expect(moveActive("ArrowDown", 0, 3)).toBe(1);
    expect(moveActive("ArrowDown", 2, 3)).toBe(2);
    expect(moveActive("ArrowUp", 1, 3)).toBe(0);
    expect(moveActive("ArrowUp", 0, 3)).toBe(0);
  });
  it("jumps with Home and End", () => {
    expect(moveActive("Home", 2, 3)).toBe(0);
    expect(moveActive("End", 0, 3)).toBe(2);
  });
  it("ignores other keys and an empty list", () => {
    expect(moveActive("x", 0, 3)).toBeNull();
    expect(moveActive("ArrowDown", 0, 0)).toBeNull();
  });
});

describe("typeahead", () => {
  const labels = ["Off", "Every 2s", "Every 5s", "Other"];
  it("finds the next label that starts with the typed text", () => {
    expect(typeahead(labels, 0, "e")).toBe(1);
    expect(typeahead(labels, 0, "ev")).toBe(1);
    expect(typeahead(labels, 3, "o")).toBe(0);
  });
  it("pressing the same letter again steps through the matches, and wraps", () => {
    expect(typeahead(labels, 1, "e")).toBe(2);
    expect(typeahead(labels, 2, "ee")).toBe(1);
  });
  it("is not case sensitive, and finds nothing for text that matches nothing", () => {
    expect(typeahead(labels, 0, "OT")).toBe(3);
    expect(typeahead(labels, 0, "zz")).toBeNull();
    expect(typeahead(labels, 0, "")).toBeNull();
  });
});

describe("listPlacement", () => {
  const view = { height: 800, width: 1200 };
  it("opens under the box", () => {
    expect(
      listPlacement(
        { top: 100, bottom: 130, left: 20, width: 200 },
        { height: 120, width: 180 },
        view,
      ),
    ).toEqual({ top: 134, left: 20, minWidth: 200 });
  });
  it("flips up near the bottom edge", () => {
    const p = listPlacement(
      { top: 760, bottom: 790, left: 20, width: 200 },
      { height: 120, width: 180 },
      view,
    );
    expect(p.top).toBe(760 - 4 - 120);
  });
  it("stays inside the window sideways", () => {
    const p = listPlacement(
      { top: 100, bottom: 130, left: 1150, width: 40 },
      { height: 60, width: 200 },
      view,
    );
    expect(p.left).toBe(1200 - 8 - 200);
  });
});
