//! The native menu bar. Items only emit an event; the UI decides what each one
//! does, because it is the part that knows whether a connection is open.

use crate::theme::ThemeChoice;
use tauri::menu::{CheckMenuItemBuilder, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Runtime};

/// Name of the event the UI listens for. The payload is one of the ids below.
pub const EVENT: &str = "menu";

pub mod id {
    pub const NEW_CONNECTION: &str = "new-connection";
    pub const CONNECTIONS: &str = "connections";
    pub const SEARCH: &str = "search";
    pub const REFRESH: &str = "refresh";
    pub const SERVER_INFO: &str = "server-info";
    pub const QUICK_OPEN: &str = "quick-open";
    pub const FIND_VALUE: &str = "find-value";
    pub const CHECK_UPDATES: &str = "check-updates";
    pub const ABOUT: &str = "about";
    pub const VIEW: &str = "view";
    pub const THEME: &str = "theme";
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: &str| {
        MenuItemBuilder::with_id(id, label)
            .accelerator(accel)
            .build(app)
    };
    let new_connection = item(id::NEW_CONNECTION, "New Connection…", "CmdOrCtrl+N")?;
    let connections = item(id::CONNECTIONS, "Connections", "CmdOrCtrl+Shift+O")?;
    let search = item(id::SEARCH, "Search Keys", "CmdOrCtrl+F")?;
    let refresh = item(id::REFRESH, "Refresh", "CmdOrCtrl+R")?;
    let server_info = item(id::SERVER_INFO, "Server Info", "CmdOrCtrl+I")?;
    let quick_open = item(id::QUICK_OPEN, "Quick Open…", "CmdOrCtrl+K")?;
    let find_value = item(id::FIND_VALUE, "Find in Value", "CmdOrCtrl+Shift+F")?;
    // macOS has a working built-in About window. Windows has the menu item but it
    // does nothing, so there the item opens our own dialog.
    #[cfg(not(target_os = "macos"))]
    let about = MenuItemBuilder::with_id(id::ABOUT, "About Fogtrail").build(app)?;
    let check_updates =
        MenuItemBuilder::with_id(id::CHECK_UPDATES, "Check for Updates…").build(app)?;

    let mut menu = MenuBuilder::new(app);

    // macOS puts the app's own menu first; the other platforms have no such menu.
    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "Fogtrail")
            .about(None)
            .item(&check_updates)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        menu = menu.item(&app_menu);
    }

    let file = SubmenuBuilder::new(app, "File")
        .item(&new_connection)
        .item(&connections)
        .separator()
        .close_window();
    #[cfg(not(target_os = "macos"))]
    let file = file.separator().quit();
    let file = file.build()?;

    // Without an Edit menu, macOS text fields lose copy, paste and undo.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let theme_item = |choice: ThemeChoice, label: &str| {
        CheckMenuItemBuilder::with_id(choice.menu_id(), label)
            .checked(choice == ThemeChoice::System)
            .build(app)
    };
    let theme = SubmenuBuilder::with_id(app, id::THEME, "Theme")
        .item(&theme_item(ThemeChoice::System, "System")?)
        .item(&theme_item(ThemeChoice::Light, "Light")?)
        .item(&theme_item(ThemeChoice::Dark, "Dark")?)
        .build()?;

    let view = SubmenuBuilder::with_id(app, id::VIEW, "View")
        .item(&quick_open)
        .item(&search)
        .item(&find_value)
        .item(&refresh)
        .item(&server_info)
        .separator()
        .item(&theme)
        .separator()
        .fullscreen()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    menu = menu.item(&file).item(&edit).item(&view).item(&window);

    #[cfg(not(target_os = "macos"))]
    {
        let help = SubmenuBuilder::new(app, "Help")
            .item(&check_updates)
            .separator()
            .item(&about)
            .build()?;
        menu = menu.item(&help);
    }

    menu.build()
}
