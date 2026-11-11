//! Full screen in one step. Windows keeps a maximized frameless window above the
//! taskbar even in full screen, so a maximized window is restored first and
//! maximized again on the way out. Doing that from the UI played the restore and
//! maximize animations in between, so the backend does it with them turned off.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WebviewWindow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Unmaximize,
    Fullscreen(bool),
    Maximize,
}

/// What to do to toggle full screen, and whether to maximize again on the way out.
pub fn plan(fullscreen: bool, maximized: bool, was_maximized: bool) -> (Vec<Step>, bool) {
    if fullscreen {
        let mut steps = vec![Step::Fullscreen(false)];
        if was_maximized {
            steps.push(Step::Maximize);
        }
        (steps, false)
    } else if maximized {
        (vec![Step::Unmaximize, Step::Fullscreen(true)], true)
    } else {
        (vec![Step::Fullscreen(true)], false)
    }
}

static WAS_MAXIMIZED: AtomicBool = AtomicBool::new(false);

/// Toggles full screen and says whether the window is now full screen. Not async,
/// so it runs on the main thread and the steps happen in order, right away.
#[tauri::command]
pub fn toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
    // Only Windows needs the maximize dance; macOS full screen handles a zoomed window.
    let maximized = cfg!(windows) && window.is_maximized().map_err(|e| e.to_string())?;
    let (steps, was) = plan(fullscreen, maximized, WAS_MAXIMIZED.load(Ordering::Relaxed));
    WAS_MAXIMIZED.store(was, Ordering::Relaxed);
    without_animations(&window, || {
        for step in steps {
            match step {
                Step::Unmaximize => window.unmaximize(),
                Step::Fullscreen(on) => window.set_fullscreen(on),
                Step::Maximize => window.maximize(),
            }
            .map_err(|e| e.to_string())?;
        }
        Ok(!fullscreen)
    })
}

/// Runs `f` with this window's minimize, maximize and restore animations off.
#[cfg(windows)]
fn without_animations<T>(window: &WebviewWindow, f: impl FnOnce() -> T) -> T {
    use windows::Win32::Graphics::Dwm::{DWMWA_TRANSITIONS_FORCEDISABLED, DwmSetWindowAttribute};
    use windows::core::BOOL;

    let hwnd = window.hwnd().ok();
    let set = |off: bool| {
        if let Some(hwnd) = hwnd {
            let value = BOOL::from(off);
            // SAFETY: a valid window handle and a BOOL of the size we pass.
            let _ = unsafe {
                DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_TRANSITIONS_FORCEDISABLED,
                    (&raw const value).cast(),
                    size_of::<BOOL>() as u32,
                )
            };
        }
    };
    set(true);
    let result = f();
    set(false);
    result
}

#[cfg(not(windows))]
fn without_animations<T>(_: &WebviewWindow, f: impl FnOnce() -> T) -> T {
    f()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_maximized_window_is_restored_first_and_maximized_again_after() {
        let (enter, was) = plan(false, true, false);
        assert_eq!(enter, [Step::Unmaximize, Step::Fullscreen(true)]);
        assert!(was);
        let (leave, was) = plan(true, false, was);
        assert_eq!(leave, [Step::Fullscreen(false), Step::Maximize]);
        assert!(!was);
    }

    #[test]
    fn a_normal_window_stays_normal() {
        let (enter, was) = plan(false, false, false);
        assert_eq!(enter, [Step::Fullscreen(true)]);
        let (leave, was) = plan(true, false, was);
        assert_eq!(leave, [Step::Fullscreen(false)]);
        assert!(!was);
    }
}
