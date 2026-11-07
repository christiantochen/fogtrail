mod commands;
pub mod connections;
pub mod drivers;
pub mod error;
mod menu;
pub mod profiles;
pub mod secrets;

use tauri::{Emitter, Manager};

use connections::Connections;
use profiles::ProfileStore;
use secrets::KeychainStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Remembers the window's size and position between launches.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .menu(menu::build)
        .on_menu_event(|app, event| {
            // The UI decides what each item does; see src/lib/menu.ts.
            let _ = app.emit(menu::EVENT, event.id().as_ref());
        })
        .setup(|app| {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
