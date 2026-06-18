//! 应用编排层
//!
//! 负责把各模块「装配」成一个运行中的 Tauri 应用：建窗口、建托盘、注册命令、
//! 起用量后台轮询。macOS 专属的窗口/面板细节都委托给 `macos` 子模块，这里只做编排，
//! 读起来是「先建弹框、提升为面板、装点击监听…」这样的高层流程。
//!
//! 同时收纳几个与窗口/托盘强相关的命令（显示主窗口、隐藏弹框、桌面卡片开关、退出）。

#[cfg(target_os = "macos")]
mod macos;

// 命令函数本身经由各自模块导入；而 `#[tauri::command]` 还会在 crate 根生成同名的
// `__tauri_command_name_*` 辅助宏，`generate_handler!` 按裸名展开引用它们，
// 所以这里再 `use crate::*` 把这些 crate 根的宏一并引入作用域。
use crate::commands::*;
use crate::usage::{fetch_and_cache, get_claude_usage, USAGE_REFRESH_SECS};
use crate::util::read_config_bool;
#[allow(unused_imports)]
use crate::*;
use tauri::{
    tray::{MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

// ── 配置读取（桌面卡片相关）──

fn read_widget_enabled() -> bool {
    read_config_bool("desktop_widget_enabled", false)
}
fn read_widget_on_top() -> bool {
    read_config_bool("widget_on_top", false)
}

// ── 窗口 / 托盘命令 ──

/// 显示并激活主窗口（菜单栏弹框里「打开主程序」用）。
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        // macOS: 命令可能运行在后台线程，用 run_on_main_thread 确保 AppKit 调用安全
        #[cfg(target_os = "macos")]
        {
            let _ = app.run_on_main_thread(move || macos::activate_main_window(&w));
        }
        #[cfg(not(target_os = "macos"))]
        let _ = w.set_focus();
    }
}

/// 隐藏菜单栏弹框。
#[tauri::command]
fn hide_tray_popup(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("tray-popup") {
        let _ = w.hide();
    }
}

/// 显示/隐藏桌面常驻用量卡片。显示时按当前配置套用层级。
#[tauri::command]
fn set_desktop_widget(app: tauri::AppHandle, enabled: bool) {
    if let Some(w) = app.get_webview_window("desktop-widget") {
        if enabled {
            let _ = w.show();
            #[cfg(target_os = "macos")]
            {
                let on_top = read_widget_on_top();
                let _ = app.run_on_main_thread(move || macos::apply_widget_layer(on_top));
            }
        } else {
            let _ = w.hide();
        }
    }
}

/// 切换桌面卡片「置顶/全屏之上」。
#[tauri::command]
fn set_widget_on_top(app: tauri::AppHandle, enabled: bool) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || macos::apply_widget_layer(enabled));
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(w) = app.get_webview_window("desktop-widget") {
            let _ = w.set_always_on_top(enabled);
        }
    }
}

/// 退出整个应用。
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ── 入口 ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // --- 系统托盘图标 ---
            let icon_bytes = include_bytes!("../../icons/tray-mascot.png");
            let icon = tauri::image::Image::from_bytes(icon_bytes)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

            // --- 透明 popup 窗口（菜单栏弹框）---
            let popup = WebviewWindowBuilder::new(app, "tray-popup", WebviewUrl::App("popup.html".into()))
                .title("")
                .decorations(false)
                .transparent(true)
                .visible(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .inner_size(300.0, 222.0)
                .build()?;

            // macOS: build() 后同步把它提升为非激活 NSPanel，并拿到 NSWindow 地址供托盘点击复用。
            // （with_webview 是异步的、排到下一帧，不能用于 show 前的设置，所以这里直接同步处理。）
            #[cfg(target_os = "macos")]
            let popup_addr = macos::promote_popup_to_panel(&popup);
            #[cfg(not(target_os = "macos"))]
            let popup_addr: usize = 0;

            // macOS: 装「点弹框以外 → 自动隐藏」的鼠标监听（需要主窗口地址做本地判定）
            #[cfg(target_os = "macos")]
            {
                let main_addr = app
                    .get_webview_window("main")
                    .map(|w| macos::ns_window_addr(&w))
                    .unwrap_or(0);
                macos::install_click_outside_monitors(popup_addr, main_addr);
            }

            // --- 桌面常驻用量卡片 (desktop widget) ---
            // 贴在桌面、可拖动、位置记忆；用量走后端共享缓存，与菜单栏/主程序一致。
            let widget = WebviewWindowBuilder::new(app, "desktop-widget", WebviewUrl::App("widget.html".into()))
                .title("")
                .decorations(false)
                .transparent(true)
                .visible(false)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .inner_size(252.0, 150.0)
                .build()?;

            // macOS: 转非激活 NSPanel + 整窗可拖动，并存指针供运行时切换层级
            #[cfg(target_os = "macos")]
            macos::promote_widget_to_panel(&widget);

            // 启动：按配置显示，并套用「是否置顶/全屏之上」层级
            if read_widget_enabled() {
                let _ = widget.show();
            }
            #[cfg(target_os = "macos")]
            macos::apply_widget_layer(read_widget_on_top());

            // --- Tray 图标（无原生菜单，点击显示/隐藏 popup）---
            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(false)
                .tooltip("Claude Cortex")
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        let click_x = position.x;
                        let app = tray.app_handle();
                        if let Some(popup) = app.get_webview_window("tray-popup") {
                            #[cfg(target_os = "macos")]
                            macos::toggle_popup_at(&popup, popup_addr, click_x);
                            #[cfg(not(target_os = "macos"))]
                            {
                                let _ = (popup_addr, click_x);
                                if popup.is_visible().unwrap_or(false) {
                                    let _ = popup.hide();
                                } else {
                                    let _ = popup.show();
                                    let _ = popup.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            // --- 主窗口关闭 → 隐藏而非退出 ---
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // --- 用量后台轮询：唯一拉取源 → 刷新缓存 → 广播给三处窗口 ---
            // 三处（主程序用量页 / 菜单栏弹框 / 桌面卡片）都只渲染这里推送的同一份数据，
            // 所以数值与精度始终一致；窗口自身不再各自定时拉取。每 30s 一次请求，开销可忽略。
            {
                use tauri::Emitter;
                let app_handle = app.handle().clone();
                std::thread::spawn(move || loop {
                    let usage = fetch_and_cache();
                    let _ = app_handle.emit("usage-updated", usage);
                    std::thread::sleep(std::time::Duration::from_secs(USAGE_REFRESH_SECS));
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_skills,
            delete_skill,
            create_skill,
            list_plugins,
            uninstall_plugin,
            list_memory,
            read_file,
            write_file,
            delete_file,
            list_sessions,
            delete_session,
            export_sessions,
            read_session_messages,
            list_project_paths,
            get_stats,
            get_cache_info,
            clear_cache,
            get_home_dir,
            get_config_path,
            list_claude_mds,
            list_rules,
            list_mcp_servers,
            check_mcp_server,
            get_claude_usage,
            show_main_window,
            hide_tray_popup,
            set_desktop_widget,
            set_widget_on_top,
            quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS: Dock 图标点击 → 主窗口隐藏时重新显示并激活
            if let tauri::RunEvent::Reopen { has_visible_windows, .. } = event {
                if !has_visible_windows {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        #[cfg(target_os = "macos")]
                        {
                            let _ = app.run_on_main_thread(move || macos::activate_main_window(&w));
                        }
                    }
                }
            }
        });
}
