import { describe, expect, it, vi } from "vitest";
import { runMenuAction, type MenuHandlers } from "./menu";

const handlers = (): MenuHandlers => ({
  newConnection: vi.fn(),
  connections: vi.fn(),
  search: vi.fn(),
  refresh: vi.fn(),
  serverInfo: vi.fn(),
  quickOpen: vi.fn(),
  findValue: vi.fn(),
  checkUpdates: vi.fn(),
});

describe("runMenuAction", () => {
  it("routes each menu id to its handler and nothing else", () => {
    const ids: [string, keyof MenuHandlers][] = [
      ["new-connection", "newConnection"],
      ["connections", "connections"],
      ["search", "search"],
      ["refresh", "refresh"],
      ["server-info", "serverInfo"],
      ["quick-open", "quickOpen"],
      ["find-value", "findValue"],
      ["check-updates", "checkUpdates"],
    ];
    for (const [id, name] of ids) {
      const h = handlers();
      expect(runMenuAction(id, h)).toBe(true);
      expect(h[name]).toHaveBeenCalledTimes(1);
      const others = Object.entries(h).filter(([k]) => k !== name);
      for (const [, fn] of others) expect(fn).not.toHaveBeenCalled();
    }
  });

  it("ignores ids it doesn't own, like predefined items", () => {
    const h = handlers();
    expect(runMenuAction("copy", h)).toBe(false);
    expect(runMenuAction("toString", h)).toBe(false);
    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });
});
