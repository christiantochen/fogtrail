import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));

const { windowAction } = await import("./windowApi");

beforeEach(() => {
  invoke.mockReset();
});

describe("full screen", () => {
  it("asks the backend, which does it in one step", async () => {
    await windowAction("win:fullscreen");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("toggle_fullscreen");
  });

  it("does not throw outside Tauri", async () => {
    invoke.mockImplementation(async () => {
      throw new Error("no backend");
    });
    await expect(windowAction("win:fullscreen")).resolves.toBeUndefined();
  });
});
