//! macOS 平台窗口组件（AppKit / NSPanel 封装）
//!
//! 整个文件仅在 macOS 下编译。它把散落在 `run()` 里的大段 `unsafe` AppKit 调用
//! 收敛成几个语义清晰的函数，让 `app::run` 读起来是「业务编排」而非「指针操作」。
//!
//! 为什么大量用 NSPanel：菜单栏弹框与桌面卡片都需要「浮在别的 App 原生全屏空间之上」，
//! 而只有**非激活面板（NonactivatingPanel）**能稳定做到这点。做法是运行时把已建好的
//! NSWindow 用 `object_setClass` 降格成 NSPanel（二者内存布局一致，安全且成熟）。

use block2::RcBlock;
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{LogicalPosition, WebviewWindow};

/// 桌面卡片的 NSWindow（已转 NSPanel）指针地址，供运行时切换层级（置顶/普通）。
pub static WIDGET_NS_WIN: AtomicUsize = AtomicUsize::new(0);

// libobjc 的 object_setClass：把已存在的 NSWindow 实例「降格」成 NSPanel。
extern "C" {
    fn object_setClass(obj: *mut AnyObject, cls: *const AnyClass) -> *const AnyClass;
}

/// 从 tauri 窗口取底层 NSWindow 指针地址；取不到返回 0。
pub fn ns_window_addr(window: &WebviewWindow) -> usize {
    window
        .window_handle()
        .ok()
        .and_then(|h| {
            if let RawWindowHandle::AppKit(a) = h.as_raw() {
                let ns_view = a.ns_view.as_ptr() as *mut AnyObject;
                let ns_win: *mut AnyObject = unsafe { msg_send![ns_view, window] };
                if ns_win.is_null() {
                    None
                } else {
                    Some(ns_win as usize)
                }
            } else {
                None
            }
        })
        .unwrap_or(0)
}

/// 把菜单栏弹框窗口提升为「非激活、浮于全屏之上」的 NSPanel。返回其 NSWindow 地址（0 表示失败）。
///
/// 关键设置：
///   ① object_setClass → NSPanel：浮在别的 App 全屏之上的前提。
///   ② styleMask 加 NonactivatingPanel(1<<7=128)：弹出时不抢焦点、不把用户踢出全屏。
///   ③ hidesOnDeactivate=false：后台时也不自动隐藏（NSPanel 默认会，必须关掉）。
///   ④ collectionBehavior=257：canJoinAllSpaces(1)|fullScreenAuxiliary(256)。
///   ⑤ level=101：NSPopUpMenuWindowLevel，高于全屏内容层。
///   ⑥ alpha=0 闪显一次：首次把窗口注册进 Space 系统，否则首次弹出可能不显示。
pub fn promote_popup_to_panel(window: &WebviewWindow) -> usize {
    let addr = ns_window_addr(window);
    if addr == 0 {
        return 0;
    }
    let ns_win = addr as *mut AnyObject;
    unsafe {
        if let Some(panel_cls) = AnyClass::get(c"NSPanel") {
            let _ = object_setClass(ns_win, panel_cls as *const AnyClass);
        }
        let mask: usize = msg_send![ns_win, styleMask];
        let _: () = msg_send![ns_win, setStyleMask: mask | 128usize];
        let _: () = msg_send![ns_win, setHidesOnDeactivate: false];
        let _: () = msg_send![ns_win, setBecomesKeyOnlyIfNeeded: true];
        let _: () = msg_send![ns_win, setFloatingPanel: true];
        let _: () = msg_send![ns_win, setCollectionBehavior: 257usize];
        let _: () = msg_send![ns_win, setLevel: 101i64];

        // 首次注册到 Space 系统：alpha=0 闪显一次
        let _: () = msg_send![ns_win, setAlphaValue: 0.0f64];
        let _: () = msg_send![ns_win, orderFrontRegardless];
        let _: () = msg_send![ns_win, orderOut: std::ptr::null_mut::<AnyObject>()];
        let _: () = msg_send![ns_win, setAlphaValue: 1.0f64];
    }
    eprintln!("[cortex] popup promoted to non-activating NSPanel");
    addr
}

/// 把桌面卡片窗口提升为非激活 NSPanel，并开启「整窗背景可拖动」，地址存入 `WIDGET_NS_WIN`。
/// 为什么也必须是 NSPanel：与弹框同理，只有非激活面板能在「置顶/全屏之上」模式可靠浮到
/// 别的 App 全屏空间上方；而桌面层(kCGDesktopWindowLevel)会被系统当背景、不收鼠标事件。
pub fn promote_widget_to_panel(window: &WebviewWindow) {
    let addr = ns_window_addr(window);
    if addr == 0 {
        return;
    }
    let ns_win = addr as *mut AnyObject;
    unsafe {
        if let Some(panel_cls) = AnyClass::get(c"NSPanel") {
            let _ = object_setClass(ns_win, panel_cls as *const AnyClass);
        }
        let mask: usize = msg_send![ns_win, styleMask];
        let _: () = msg_send![ns_win, setStyleMask: mask | 128usize]; // NonactivatingPanel
        let _: () = msg_send![ns_win, setHidesOnDeactivate: false];
        let _: () = msg_send![ns_win, setBecomesKeyOnlyIfNeeded: true];
        // 整窗背景可拖动：点卡片任意处都能拖
        let _: () = msg_send![ns_win, setMovableByWindowBackground: true];
    }
    WIDGET_NS_WIN.store(addr, Ordering::Relaxed);
}

/// 按「是否置顶/全屏之上」套用桌面卡片的窗口层级与 Space 行为。必须在主线程调用。
pub fn apply_widget_layer(on_top: bool) {
    let addr = WIDGET_NS_WIN.load(Ordering::Relaxed);
    if addr == 0 {
        return;
    }
    let ns_win = addr as *mut AnyObject;
    unsafe {
        if on_top {
            // 置顶 + 全屏之上：popUpMenu 级 + canJoinAllSpaces(1)|fullScreenAuxiliary(256)=257
            let _: () = msg_send![ns_win, setLevel: 101i64];
            let _: () = msg_send![ns_win, setCollectionBehavior: 257usize];
            let vis: bool = msg_send![ns_win, isVisible];
            if vis {
                let _: () = msg_send![ns_win, orderFrontRegardless];
            }
        } else {
            // 普通：默认层级 + 默认 Space 行为(0)。
            // 关键：不能用 canJoinAllSpaces，否则卡片会强行钻进别的 App 全屏空间、仍浮在上面。
            let _: () = msg_send![ns_win, setLevel: 0i64];
            let _: () = msg_send![ns_win, setCollectionBehavior: 0usize];
            // 主动排到最底，离开「最前」位置，恢复「会被前台窗口遮挡」
            let vis: bool = msg_send![ns_win, isVisible];
            if vis {
                let _: () = msg_send![ns_win, orderBack: std::ptr::null_mut::<AnyObject>()];
            }
        }
    }
}

/// 安装「点击弹框以外任意位置 → 自动隐藏弹框」的两个鼠标监听。
///
/// 弹框是非激活面板、不抢焦点，blur/resignKey 不可靠，故用 NSEvent 监听鼠标按下：
///   · 全局监听：点别的 App / 全屏内容 / 桌面（事件发给其它 App）→ 隐藏。
///   · 本地监听：点本应用主窗口（事件发给自己）→ 隐藏；点弹框自身或托盘图标 → 保留。
/// 只监听鼠标、不监听键盘 → 无需「输入监控」权限。
pub fn install_click_outside_monitors(popup_addr: usize, main_addr: usize) {
    let nsevent_cls = AnyClass::get(c"NSEvent");
    // NSEventMaskLeftMouseDown(1<<1) | RightMouseDown(1<<3) = 10
    const MOUSE_DOWN_MASK: u64 = 10;

    // 全局：点其它 App / 全屏内容 / 桌面 → 隐藏
    if popup_addr != 0 {
        if let Some(cls) = nsevent_cls {
            let g = RcBlock::new(move |_e: *mut AnyObject| {
                let popup = popup_addr as *mut AnyObject;
                unsafe {
                    let visible: bool = msg_send![popup, isVisible];
                    if visible {
                        let _: () = msg_send![popup, orderOut: std::ptr::null_mut::<AnyObject>()];
                    }
                }
            });
            unsafe {
                let _: *mut AnyObject =
                    msg_send![cls, addGlobalMonitorForEventsMatchingMask: MOUSE_DOWN_MASK, handler: &*g];
            }
        }
    }

    // 本地：点主窗口 → 隐藏；点弹框 / 托盘 → 保留（不返回 nil，点击照常生效）
    if popup_addr != 0 && main_addr != 0 {
        if let Some(cls) = nsevent_cls {
            let l = RcBlock::new(move |event: *mut AnyObject| -> *mut AnyObject {
                let popup = popup_addr as *mut AnyObject;
                unsafe {
                    let visible: bool = msg_send![popup, isVisible];
                    if visible {
                        let ewin: *mut AnyObject = msg_send![event, window];
                        if ewin as usize == main_addr {
                            let _: () = msg_send![popup, orderOut: std::ptr::null_mut::<AnyObject>()];
                        }
                    }
                }
                event
            });
            unsafe {
                let _: *mut AnyObject =
                    msg_send![cls, addLocalMonitorForEventsMatchingMask: MOUSE_DOWN_MASK, handler: &*l];
            }
        }
    }
}

/// 托盘图标点击：弹框可见则隐藏，否则定位到点击位置下方并浮出。
/// `click_x` 是托盘点击的物理 x 坐标（来自 TrayIconEvent）。
pub fn toggle_popup_at(popup: &WebviewWindow, ns_addr: usize, click_x: f64) {
    if ns_addr == 0 {
        return;
    }
    let ns_win = ns_addr as *mut AnyObject;
    unsafe {
        let is_visible: bool = msg_send![ns_win, isVisible];
        if is_visible {
            let _ = popup.hide();
        } else {
            let scale = popup.scale_factor().unwrap_or(1.0);
            // 让弹框中心大致对齐图标，并夹住左边界不出屏
            let lx = (click_x / scale - 150.0).max(8.0);
            let _ = popup.set_position(LogicalPosition::new(lx, 28.0));
            let _: () = msg_send![ns_win, setCollectionBehavior: 257usize];
            let _: () = msg_send![ns_win, setLevel: 101i64];
            let _: () = msg_send![ns_win, orderFrontRegardless];
        }
    }
}

/// 激活并前置主窗口（点 Dock 图标、点托盘的「显示主窗口」时复用）。必须在主线程调用。
pub fn activate_main_window(window: &WebviewWindow) {
    let addr = ns_window_addr(window);
    if addr == 0 {
        return;
    }
    let ns_win = addr as *mut AnyObject;
    unsafe {
        if let Some(cls) = AnyClass::get(c"NSApplication") {
            let ns_app: *mut AnyObject = msg_send![cls, sharedApplication];
            let _: () = msg_send![ns_app, activateIgnoringOtherApps: true];
        }
        let _: () = msg_send![ns_win, makeKeyAndOrderFront: std::ptr::null_mut::<AnyObject>()];
    }
}
