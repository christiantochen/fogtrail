import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake window that records what was asked of it.
const state = { maximized: false, fullscreen: false, calls: [] as string[] };
const fake = {
  isMaximized: async () => state.maximized,
  isFullscreen: async () => state.fullscreen,
  toggleMaximize: async () => {
    state.calls.push("toggleMaximize");
    state.maximized = !state.maximized;
  },
  setFullscreen: async (on: boolean) => {
    state.calls.push(`setFullscreen:${on}`);
    state.fullscreen = on;
  },
};
let current: () => unknown = () => fake;
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => current(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));

const { windowAction } = await import("./windowApi");

beforeEach(() => {
  state.maximized = false;
  state.fullscreen = false;
  state.calls = [];
  current = () => fake;
});

describe("full screen", () => {
  it("restores a maximized window first, then maximizes it again", async () => {
    state.maximized = true;
    await windowAction("win:fullscreen");
    expect(state).toMatchObject({ maximized: false, fullscreen: true });
    await windowAction("win:fullscreen");
    expect(state).toMatchObject({ maximized: true, fullscreen: false });
    expect(state.calls).toEqual([
      "toggleMaximize",
      "setFullscreen:true",
      "setFullscreen:false",
      "toggleMaximize",
    ]);
  });

  it("leaves a normal window normal", async () => {
    await windowAction("win:fullscreen");
    await windowAction("win:fullscreen");
    expect(state).toMatchObject({ maximized: false, fullscreen: false });
    expect(state.calls).toEqual(["setFullscreen:true", "setFullscreen:false"]);
  });

  it("does not throw outside Tauri", async () => {
    current = () => {
      throw new Error("no window");
    };
    await expect(windowAction("win:fullscreen")).resolves.toBeUndefined();
  });
});
