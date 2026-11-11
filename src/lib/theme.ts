/** The colour scheme the person picked. "system" follows the OS. */
export type Theme = "system" | "light" | "dark";

export const THEMES: readonly Theme[] = ["system", "light", "dark"];

const KEY = "fogtrail.theme";

/** Anything that isn't a known theme means "system". */
export function parseTheme(v: unknown): Theme {
  return v === "light" || v === "dark" ? v : "system";
}

export function loadTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return "system";
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Not remembering is fine.
  }
}

/** The scheme to draw: the pick, or the OS setting when the pick is "system". */
export function resolveTheme(
  theme: Theme,
  systemDark: boolean,
): "light" | "dark" {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

const dark = () => window.matchMedia("(prefers-color-scheme: dark)");

/** Puts the scheme on the page. The stylesheet reads `data-theme` on <html>. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme, dark().matches);
}

/** Calls back when the OS switches between light and dark. Returns an unsubscribe. */
export function onSystemThemeChange(cb: () => void): () => void {
  const q = dark();
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}
