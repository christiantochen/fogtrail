import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "../lib/theme";

/** Tells the app shell the pick, so the native menu ticks it and the window frame follows. */
export async function syncNativeTheme(theme: Theme): Promise<void> {
  try {
    await invoke("set_theme", { theme });
  } catch {
    // A plain browser (development) has no shell to tell.
  }
}
