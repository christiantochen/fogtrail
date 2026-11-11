//! The colour scheme the person picked in the UI. Windows has no native menu, so
//! there this only sets the window theme.

use tauri::{AppHandle, Manager, Theme, window::Color};
#[cfg(not(windows))]
use tauri::{Runtime, menu::MenuItemKind};

/// The UI owns the choice and tells us, so the menu can tick it and the window
/// frame can follow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThemeChoice {
    System,
    Light,
    Dark,
}

impl ThemeChoice {
    #[cfg_attr(windows, allow(dead_code))]
    const ALL: [ThemeChoice; 3] = [ThemeChoice::System, ThemeChoice::Light, ThemeChoice::Dark];

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "system" => Some(Self::System),
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }

    /// `None` lets the window follow the OS again.
    pub fn window_theme(self) -> Option<Theme> {
        match self {
            Self::System => None,
            Self::Light => Some(Theme::Light),
            Self::Dark => Some(Theme::Dark),
        }
    }

    #[cfg_attr(windows, allow(dead_code))]
    pub fn menu_id(self) -> &'static str {
        match self {
            Self::System => "theme-system",
            Self::Light => "theme-light",
            Self::Dark => "theme-dark",
        }
    }
}

/// The page's main background (`--main` in src/styles.css), so a part of the window
/// the page hasn't painted yet (during a resize) is the app's colour, not white.
pub fn background(theme: Theme) -> Color {
    match theme {
        Theme::Dark => Color(0x1a, 0x21, 0x28, 0xff),
        _ => Color(0xfa, 0xfb, 0xfc, 0xff),
    }
}

/// Ticks the chosen theme in the native View > Theme menu and unticks the others.
/// Windows has no native menu (it draws its own), so there this finds nothing.
#[cfg(not(windows))]
fn tick_theme<R: Runtime>(app: &AppHandle<R>, choice: ThemeChoice) {
    let Some(menu) = app.menu() else { return };
    let Some(MenuItemKind::Submenu(view)) = menu.get(crate::menu::id::VIEW) else {
        return;
    };
    let Some(MenuItemKind::Submenu(theme)) = view.get(crate::menu::id::THEME) else {
        return;
    };
    for each in ThemeChoice::ALL {
        if let Some(MenuItemKind::Check(item)) = theme.get(each.menu_id()) {
            let _ = item.set_checked(each == choice);
        }
    }
}

/// Called by the UI whenever the theme changes, once at start, and when the OS
/// changes theme while the pick is System.
#[tauri::command]
pub fn set_theme(app: AppHandle, theme: String) -> Result<(), String> {
    let choice = ThemeChoice::parse(&theme).ok_or_else(|| format!("Unknown theme: {theme}"))?;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_theme(choice.window_theme());
        // With System, the window now reports the OS theme.
        if let Ok(shown) = window.theme() {
            let _ = window.set_background_color(Some(background(shown)));
        }
    }
    #[cfg(not(windows))]
    tick_theme(&app, choice);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn theme_names_map_to_choices_and_unknown_ones_are_refused() {
        assert_eq!(ThemeChoice::parse("system"), Some(ThemeChoice::System));
        assert_eq!(ThemeChoice::parse("light"), Some(ThemeChoice::Light));
        assert_eq!(ThemeChoice::parse("dark"), Some(ThemeChoice::Dark));
        for bad in ["", "Dark", "blue", "system "] {
            assert_eq!(ThemeChoice::parse(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn system_hands_the_window_back_to_the_os() {
        assert_eq!(ThemeChoice::System.window_theme(), None);
        assert_eq!(ThemeChoice::Light.window_theme(), Some(Theme::Light));
        assert_eq!(ThemeChoice::Dark.window_theme(), Some(Theme::Dark));
    }

    #[test]
    fn the_background_matches_the_page() {
        assert_eq!(background(Theme::Light), Color(0xfa, 0xfb, 0xfc, 0xff));
        assert_eq!(background(Theme::Dark), Color(0x1a, 0x21, 0x28, 0xff));
    }

    #[test]
    fn each_choice_has_its_own_menu_id() {
        let ids: Vec<_> = ThemeChoice::ALL.iter().map(|c| c.menu_id()).collect();
        assert_eq!(ids, ["theme-system", "theme-light", "theme-dark"]);
    }
}
