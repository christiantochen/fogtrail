import { invoke } from "@tauri-apps/api/core";
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
        // The backend keeps the whole screen on Windows (see src-tauri/src/window.rs).
        await invoke("toggle_fullscreen");
        return;
    }
  } catch {
    // Outside Tauri there is no window to control.
  }
}
