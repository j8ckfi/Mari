//! Native macOS "glass" behind the transparent webview.
//!
//! On macOS 26+ we use the real Liquid Glass surface (`NSGlassEffectView`) for
//! the refractive warping; on older systems we fall back to `NSVisualEffectView`
//! vibrancy (frosted blur). Either way the effect fills the whole window behind
//! the webview — the frontend reveals it only through the sidebar (whose
//! surface turns transparent when the glass setting is on); every other pane
//! paints an opaque surface on top, so the effect is invisible when off.

use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject};
use objc2_app_kit::{NSAutoresizingMaskOptions, NSView, NSWindowOrderingMode};
use objc2_foundation::MainThreadMarker;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::ffi::c_void;
use std::ptr::NonNull;
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

/// Attach the glass effect to the window's webview. Safe no-op if the handle
/// can't be resolved or we're off the main thread.
pub fn apply_sidebar_glass(window: &tauri::WebviewWindow) {
    let Some(ns_view) = webview_ns_view(window) else {
        return;
    };
    // AppKit view mutation must happen on the main thread (Tauri setup is).
    if MainThreadMarker::new().is_none() {
        return;
    }

    // Prefer real Liquid Glass (macOS 26+); otherwise frosted vibrancy.
    if unsafe { try_liquid_glass(ns_view) } {
        return;
    }
    let _ = apply_vibrancy(
        window,
        NSVisualEffectMaterial::Sidebar,
        Some(NSVisualEffectState::FollowsWindowActiveState),
        None,
    );
}

/// The webview's backing `NSView` (the same target `window-vibrancy` uses).
fn webview_ns_view(window: &tauri::WebviewWindow) -> Option<NonNull<c_void>> {
    let handle = window.window_handle().ok()?;
    match handle.as_raw() {
        RawWindowHandle::AppKit(h) => Some(h.ns_view),
        _ => None,
    }
}

/// Insert a full-bleed `NSGlassEffectView` behind the webview. Returns `false`
/// when the class is unavailable (pre-macOS 26), so the caller can fall back.
unsafe fn try_liquid_glass(ns_view: NonNull<c_void>) -> bool {
    let Some(cls) = AnyClass::get(c"NSGlassEffectView") else {
        return false;
    };
    let view: &NSView = ns_view.cast().as_ref();
    let bounds = view.bounds();

    let glass: *mut AnyObject = msg_send![cls, alloc];
    let glass: *mut AnyObject = msg_send![glass, initWithFrame: bounds];
    if glass.is_null() {
        return false;
    }
    // Flat, full-window glass — not a floating rounded pill.
    let _: () = msg_send![glass, setCornerRadius: 0.0_f64];

    let glass_view: &NSView = &*glass.cast::<NSView>();
    glass_view.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    view.addSubview_positioned_relativeTo(glass_view, NSWindowOrderingMode::Below, None);
    true
}
