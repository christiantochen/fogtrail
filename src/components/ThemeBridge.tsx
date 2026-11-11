import { useEffect } from "react";
import { syncNativeTheme } from "../api/theme";
import { applyTheme, onSystemThemeChange, saveTheme } from "../lib/theme";
import { useUi } from "../state/ui";

/** Keeps the page, the saved pick and the native shell in step with the theme. Renders nothing. */
export function ThemeBridge() {
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
    void syncNativeTheme(theme);
    // "system" has to follow the OS while the app is open.
    return theme === "system"
      ? onSystemThemeChange(() => applyTheme("system"))
      : undefined;
  }, [theme]);

  return null;
}
