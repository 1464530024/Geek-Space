// ============================================================
// 极客空间 Geek Space — 系统托盘（仅桌面端）
// ------------------------------------------------------------
// 关闭窗口不退出程序，缩到任务栏右侧通知区域常驻；
// 鼠标悬停即可看到 CPU 使用率 / 温度、内存、GPU、网速五项简讯。
// 左键点图标 = 显示/隐藏窗口，右键 = 菜单（显示 / 隐藏 / 退出）。
// ============================================================

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::collector::{self, LiveSnapshot};

/// 「关闭窗口时缩到托盘」开关。默认开启 —— 任务要求关窗后仍在托盘常驻。
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

pub fn set_close_to_tray(on: bool) {
    CLOSE_TO_TRAY.store(on, Ordering::Relaxed);
}

pub fn close_to_tray() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

// ============================================================
// 窗口显隐
// ============================================================
fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn hide_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        // is_visible 在最小化时仍返回 true，所以要结合 is_minimized 判断
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = w.hide();
        } else {
            show_window(app);
        }
    }
}

// ============================================================
// 悬浮提示文案
// ============================================================

/// 网速统一从 KB/s 转成人能读的单位
fn fmt_speed(kbps: f64) -> String {
    if kbps >= 1024.0 {
        format!("{:.1}M/s", kbps / 1024.0)
    } else if kbps >= 100.0 {
        format!("{:.0}K/s", kbps)
    } else if kbps >= 1.0 {
        format!("{:.1}K/s", kbps)
    } else {
        "0K/s".to_string()
    }
}

fn tooltip_text(s: &LiveSnapshot) -> String {
    let cpu = match s.cpu_temp {
        Some(t) if t > 0.0 => format!("CPU {:.0}% · {:.0}°C", s.cpu_usage, t),
        _ => format!("CPU {:.0}%", s.cpu_usage),
    };
    let mem = format!(
        "内存 {:.1}G · {:.0}%",
        s.mem_used_gb, s.mem_percent
    );
    let gpu = match s.gpu_usage {
        Some(g) if g >= 0.0 => format!("GPU {:.0}%", g),
        _ => "GPU —".to_string(),
    };
    format!(
        "极客空间 · Geek Space\n{}\n{}\n{}\n网速 ↓{} ↑{}",
        cpu,
        mem,
        gpu,
        fmt_speed(s.net_down),
        fmt_speed(s.net_up)
    )
}

/// Windows 的 szTip 上限 128 字符，超出会被截断，这里保险再砍一次
fn clamp_tip(mut s: String) -> String {
    if s.chars().count() > 120 {
        s = s.chars().take(118).collect::<String>();
        s.push('…');
    }
    s
}

// ============================================================
// 初始化
// ============================================================
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口 / Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "隐藏窗口 / Hide", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 / Quit", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &hide, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("极客空间 · Geek Space\n正在采集…")
        .menu(&menu)
        // 左键留给"显示/隐藏窗口"，菜单只在右键弹出
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_window(app),
            "hide" => hide_window(app),
            "quit" => {
                // 真正退出：先放开托盘拦截，再退出，避免 CloseRequested 又把它藏起来
                CLOSE_TO_TRAY.store(false, Ordering::Relaxed);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;

    start_tip_loop(app.clone());
    Ok(())
}

/// 悬浮提示刷新线程：每 1.5 秒读一次缓存，切回主线程改托盘文本。
///
/// 托盘 API 走的是 Shell_NotifyIcon，统一放主线程执行最稳；
/// 而采集本身在后台线程完成，两边互不阻塞。
fn start_tip_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1500));

        let tip = match collector::peek_live() {
            Some(s) => clamp_tip(tooltip_text(&s)),
            None => "极客空间 · Geek Space\n正在采集…".to_string(),
        };

        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(tray) = handle.tray_by_id("main") {
                let _ = tray.set_tooltip(Some(tip.as_str()));
            }
        });
    });
}
