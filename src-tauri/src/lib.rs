mod commands;
pub mod connections;
pub mod drivers;
pub mod error;
// Windows draws its own title bar and menus (see src/components/TitleBar.tsx).
#[cfg(not(windows))]
mod menu;
pub mod profiles;
pub mod secrets;
pub mod sql_guard;

#[cfg(not(windows))]
use tauri::Emitter;
use tauri::Manager;

use connections::Connections;
use profiles::ProfileStore;
use secrets::KeychainStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Remembers the window's size and position between launches. Not whether it
        // has a frame: Windows draws its own title bar (tauri.windows.conf.json), and
        // a frame saved by an older version would bring the OS one back.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        // Self-update: the updater checks GitHub for a signed release and
        // installs it; the process plugin restarts the app afterwards.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(not(windows))]
    let builder = builder.menu(menu::build).on_menu_event(|app, event| {
        // The UI decides what each item does; see src/lib/menu.ts.
        let _ = app.emit(menu::EVENT, event.id().as_ref());
    });

    builder
        .setup(|app| {
            // Windows draws its own title bar; make sure no OS frame is left over.
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
            }
            let dir = app.path().app_data_dir()?;
            let store = ProfileStore::new(dir.join("connections.json"));
            app.manage(Connections::new(store, Box::new(KeychainStore)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::test_connection,
            commands::connect,
            commands::disconnect,
            commands::connection_info,
            commands::scan_keys,
            commands::get_key,
            commands::stream_page,
            commands::server_info,
            commands::select_database,
            commands::list_schemas,
            commands::list_tables,
            commands::table_structure,
            commands::table_rows,
            commands::run_query,
            commands::cancel_query,
            menu::set_theme,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
