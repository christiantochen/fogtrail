import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";

// Thin wrappers over the window, so a missing window (a plain browser during
// development) never throws into the UI.

const win = () => getCurrentWindow();

/** True when the OS draws the window frame; false means we draw our own. */
export async function hasNativeFrame(): Promise<boolean> {
  try {
    return await win().isDecorated();
  } catch {
    return true;
  }
}

export async function isMaximized(): Promise<boolean> {
  try {
    return await win().isMaximized();
  } catch {
    return false;
  }
}

export async function isFullscreen(): Promise<boolean> {
  try {
    return await win().isFullscreen();
  } catch {
    return false;
  }
}

// Whether the window was maximized when full screen began, so leaving it puts
// the window back the way it was.
let maximizedBeforeFullscreen = false;

/**
 * Windows keeps a maximized frameless window above the taskbar, even in full
 * screen, so a maximized window is restored first and maximized again after.
 */
async function toggleFullscreen(): Promise<void> {
  const w = win();
  if (await w.isFullscreen()) {
    await w.setFullscreen(false);
    if (maximizedBeforeFullscreen) await w.toggleMaximize();
    maximizedBeforeFullscreen = false;
    return;
  }
  maximizedBeforeFullscreen = await w.isMaximized();
  if (maximizedBeforeFullscreen) await w.toggleMaximize();
  await w.setFullscreen(true);
}

/** Calls back when the window is resized or maximized. Returns an unsubscribe. */
export function onResized(cb: () => void): () => void {
  let off: (() => void) | undefined;
  let gone = false;
  win()
    .onResized(cb)
    .then((fn) => (gone ? fn() : (off = fn)))
    .catch(() => undefined);
  return () => {
    gone = true;
    off?.();
  };
}

export async function windowAction(id: string): Promise<void> {
  try {
    const w = win();
    switch (id) {
      case "win:minimize":
        return await w.minimize();
      case "win:maximize":
        return await w.toggleMaximize();
      case "win:close":
        return await w.close();
      case "win:exit":
        return await exit(0);
      case "win:fullscreen":
        return await toggleFullscreen();
    }
  } catch {
    // Outside Tauri there is no window to control.
  }
}
