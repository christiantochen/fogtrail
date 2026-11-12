//! Full screen without a flash. The window library keeps a maximized frameless
//! window above the taskbar (it trims the window in WM_NCCALCSIZE), even in full
//! screen. Restoring the window first made it flash small, then big. Instead, a
//! handler of ours sees WM_NCCALCSIZE first and, only while in full screen, sizes
//! the page to the whole screen right away. The page changes size once.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::WebviewWindow;

/// True while the window is in full screen, so the handler knows to step in.
static FULLSCREEN: AtomicBool = AtomicBool::new(false);

/// The Windows message that sizes the window's client area.
const WM_NCCALCSIZE: u32 = 0x0083;

/// Whether our handler answers this message itself: the client-area sizing
/// message (with its rectangles, wparam non-zero) while in full screen.
pub fn keeps_whole_screen(msg: u32, wparam: usize, fullscreen: bool) -> bool {
    msg == WM_NCCALCSIZE && wparam != 0 && fullscreen
}

/// Toggles full screen and says whether the window is now full screen. Not async,
/// so it runs on the main thread and the handler's flag is set before the resize.
#[tauri::command]
pub fn toggle_fullscreen(window: WebviewWindow) -> Result<bool, String> {
    let on = !window.is_fullscreen().map_err(|e| e.to_string())?;
    FULLSCREEN.store(on, Ordering::Relaxed);
    window.set_fullscreen(on).map_err(|e| e.to_string())?;
    Ok(on)
}

/// Puts our handler on the window. Call once, after the window exists.
#[cfg(windows)]
pub fn install(window: &WebviewWindow) {
    use windows::Win32::UI::Shell::SetWindowSubclass;

    FULLSCREEN.store(window.is_fullscreen().unwrap_or(false), Ordering::Relaxed);
    if let Ok(hwnd) = window.hwnd() {
        // SAFETY: a live window handle and a procedure that lives for the program.
        // Added after the window library's own, so it sees each message first.
        let _ = unsafe { SetWindowSubclass(hwnd, Some(subclass), 1, 0) };
    }
}

#[cfg(windows)]
unsafe extern "system" fn subclass(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
    _id: usize,
    _data: usize,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
    };
    use windows::Win32::UI::Shell::DefSubclassProc;
    use windows::Win32::UI::WindowsAndMessaging::NCCALCSIZE_PARAMS;

    if keeps_whole_screen(msg, wparam.0, FULLSCREEN.load(Ordering::Relaxed)) {
        // The page gets the screen's exact size at once, not the maximized
        // window's (which reaches past the screen's edges), so when the window
        // then grows to fill the screen the page doesn't resize a second time.
        let mut info = MONITORINFO {
            cbSize: size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        // SAFETY: a live window handle; with wparam non-zero, lparam points to
        // the NCCALCSIZE_PARAMS Windows passes for this message.
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if GetMonitorInfoW(monitor, &mut info).as_bool() {
                (*(lparam.0 as *mut NCCALCSIZE_PARAMS)).rgrc[0] = info.rcMonitor;
            }
        }
        return LRESULT(0);
    }
    // SAFETY: passes the message on, unchanged, to the next handler.
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_in_only_for_client_sizing_while_in_full_screen() {
        assert!(keeps_whole_screen(WM_NCCALCSIZE, 1, true));
        // Not in full screen: the window library trims a maximized window as before.
        assert!(!keeps_whole_screen(WM_NCCALCSIZE, 1, false));
        // Without rectangles to fill there is nothing to keep.
        assert!(!keeps_whole_screen(WM_NCCALCSIZE, 0, true));
        // Any other message goes on to the window library.
        assert!(!keeps_whole_screen(0x0005, 1, true));
    }
}
