//! The right-click menu on Windows. WebView2 comes with a browser menu: Back, Reload,
//! Save as, Print, Share, Inspect and more, none of which a data browser needs. Just
//! before the menu opens, we take out every item except the basic editing ones, and
//! if nothing is left the menu doesn't open at all.

/// WebView2's names for the items worth keeping: the editing commands.
#[cfg(any(windows, test))]
const KEEP: &[&str] = &[
    "undo",
    "redo",
    "cut",
    "copy",
    "paste",
    "pasteAsPlainText",
    "delete",
    "selectAll",
];

/// One item of the menu as WebView2 describes it.
#[cfg(any(windows, test))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub separator: bool,
}

/// Whether a command stays. Inspect also stays in a development build, so DevTools
/// is still one right-click away while building the app.
#[cfg(any(windows, test))]
fn keeps(name: &str, debug: bool) -> bool {
    KEEP.contains(&name) || (debug && name == "inspectElement")
}

/// The positions to remove, last first, so removing one doesn't move the next.
/// Besides the commands that go, a separator goes when it would sit first, last or
/// right after another separator.
#[cfg(any(windows, test))]
pub fn removals(items: &[Entry], debug: bool) -> Vec<usize> {
    let command_stays: Vec<bool> = items
        .iter()
        .map(|e| !e.separator && keeps(&e.name, debug))
        .collect();
    let mut removed = Vec::new();
    let mut after_command = false;
    for (i, item) in items.iter().enumerate() {
        if item.separator {
            let more_to_come = command_stays[i + 1..].iter().any(|&k| k);
            if after_command && more_to_come {
                after_command = false;
            } else {
                removed.push(i);
            }
        } else if command_stays[i] {
            after_command = true;
        } else {
            removed.push(i);
        }
    }
    removed.reverse();
    removed
}

/// Puts the filter on the window's menu. Call once, after the window exists.
#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) {
    use webview2_com::ContextMenuRequestedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_11;
    use windows::core::Interface;

    let _ = window.with_webview(|webview| {
        // SAFETY: the controller is alive for as long as the window; the handler only
        // touches the arguments WebView2 hands it, on the thread it calls us on.
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            // The menu event arrived in a later version than the base interface.
            let Ok(core) = core.cast::<ICoreWebView2_11>() else {
                return;
            };
            let handler =
                ContextMenuRequestedEventHandler::create(Box::new(|_, args| match args {
                    Some(args) => trim(&args),
                    None => Ok(()),
                }));
            let mut token = 0i64;
            let _ = core.add_ContextMenuRequested(&handler, &mut token);
        }
    });
}

/// Takes the unwanted items out of the menu that is about to open.
#[cfg(windows)]
unsafe fn trim(
    args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2ContextMenuRequestedEventArgs,
) -> windows::core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
    };
    use windows::core::PWSTR;

    // SAFETY: the calls below are WebView2's own, on objects it gave us for this event.
    unsafe {
        let menu = args.MenuItems()?;
        let mut count = 0u32;
        menu.Count(&mut count)?;
        let mut items = Vec::with_capacity(count as usize);
        for i in 0..count {
            let item = menu.GetValueAtIndex(i)?;
            let mut name = PWSTR::null();
            item.Name(&mut name)?;
            let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
            item.Kind(&mut kind)?;
            items.push(Entry {
                name: webview2_com::take_pwstr(name),
                separator: kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
            });
        }
        let removed = removals(&items, cfg!(debug_assertions));
        for &i in &removed {
            menu.RemoveValueAtIndex(i as u32)?;
        }
        // Nothing left worth showing: don't show an empty menu.
        if removed.len() == items.len() {
            args.SetHandled(true)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(name: &str) -> Entry {
        Entry {
            name: name.into(),
            separator: false,
        }
    }
    fn sep() -> Entry {
        Entry {
            name: String::new(),
            separator: true,
        }
    }
    fn left(items: &[Entry], debug: bool) -> Vec<String> {
        let gone = removals(items, debug);
        items
            .iter()
            .enumerate()
            .filter(|(i, _)| !gone.contains(i))
            .map(|(_, e)| {
                if e.separator {
                    "-".to_string()
                } else {
                    e.name.clone()
                }
            })
            .collect()
    }

    #[test]
    fn the_page_menu_goes_entirely() {
        let items = [
            item("back"),
            item("forward"),
            item("reload"),
            sep(),
            item("saveAs"),
            item("print"),
            item("share"),
            sep(),
            item("inspectElement"),
        ];
        assert!(left(&items, false).is_empty());
    }

    #[test]
    fn a_text_box_keeps_its_editing_commands() {
        let items = [
            item("undo"),
            item("redo"),
            sep(),
            item("cut"),
            item("copy"),
            item("paste"),
            item("pasteAsPlainText"),
            item("delete"),
            sep(),
            item("selectAll"),
            sep(),
            item("emoji"),
            sep(),
            item("inspectElement"),
        ];
        assert_eq!(
            left(&items, false),
            [
                "undo",
                "redo",
                "-",
                "cut",
                "copy",
                "paste",
                "pasteAsPlainText",
                "delete",
                "-",
                "selectAll"
            ]
        );
    }

    #[test]
    fn selected_text_keeps_copy_without_stray_separators() {
        let items = [
            item("copy"),
            sep(),
            item("print"),
            item("share"),
            sep(),
            item("inspectElement"),
        ];
        assert_eq!(left(&items, false), ["copy"]);
    }

    #[test]
    fn a_separator_never_leads_trails_or_doubles() {
        let items = [
            item("back"),
            sep(),
            item("cut"),
            sep(),
            item("print"),
            sep(),
            item("copy"),
            sep(),
        ];
        assert_eq!(left(&items, false), ["cut", "-", "copy"]);
    }

    #[test]
    fn inspect_stays_only_in_a_development_build() {
        let items = [item("copy"), sep(), item("inspectElement")];
        assert_eq!(left(&items, true), ["copy", "-", "inspectElement"]);
        assert_eq!(left(&items, false), ["copy"]);
    }

    #[test]
    fn removals_come_last_first() {
        let items = [item("back"), item("copy"), item("print")];
        assert_eq!(removals(&items, false), [2, 0]);
    }

    #[test]
    fn an_empty_menu_stays_empty() {
        assert!(removals(&[], false).is_empty());
    }
}
