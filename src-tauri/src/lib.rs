// ============================================================
// 极客空间 Geek Space — Tauri 后端入口
// 真实硬件采集通过 Tauri command 暴露给前端；
// 前端在 window.__TAURI__ 不存在时自动回退到内置模拟引擎。
// ============================================================

// 设为 pub 是为了让 main.rs 的诊断模式（--dump-device）能直接调用采集层
pub mod collector;
// Android / Linux 采集层。Windows 上也会编译（便于本机 cargo check），
// 但只在非 Windows 分支被调用。
mod hw_linux;
// 系统托盘（关闭窗口后常驻任务栏右侧，悬停显示实时简讯）—— 仅桌面端
#[cfg(desktop)]
mod tray;

use collector::{
    DeviceProfile, DriverItem, LiveSnapshot, ProcessInfo, SensorReading, StartupItem,
};

// ============================================================
// 所有命令一律 async + spawn_blocking
// ------------------------------------------------------------
// Tauri 的**同步**命令会在 WebView 主线程上执行，而我们的采集里有
// WMI / PowerShell / nvidia-smi 这类几百毫秒到数秒的阻塞调用 ——
// 一旦跑在主线程，用户点侧边栏就会出现"卡一两秒才切换"。
// 改成 async 后命令落到独立线程池，UI 永远不被采集拖住。
// ============================================================

#[tauri::command]
async fn device_profile() -> DeviceProfile {
    tauri::async_runtime::spawn_blocking(collector::get_profile)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn live_snapshot() -> LiveSnapshot {
    tauri::async_runtime::spawn_blocking(collector::get_live)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn sensor_list() -> Vec<SensorReading> {
    tauri::async_runtime::spawn_blocking(collector::get_sensors)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn startup_items() -> Vec<StartupItem> {
    tauri::async_runtime::spawn_blocking(collector::get_startup_items)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn driver_list() -> Vec<DriverItem> {
    tauri::async_runtime::spawn_blocking(collector::get_drivers)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn top_processes() -> Vec<ProcessInfo> {
    tauri::async_runtime::spawn_blocking(collector::get_top_processes)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn capabilities() -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(collector::capabilities)
        .await
        .unwrap_or(serde_json::Value::Null)
}

/// 设置「关闭窗口时缩到托盘」。
/// 移动端没有托盘概念，直接忽略。
#[tauri::command]
fn set_close_to_tray(on: bool) {
    #[cfg(desktop)]
    tray::set_close_to_tray(on);
    #[cfg(not(desktop))]
    let _ = on;
}

/// 供前端「打开主窗口」类操作使用（如设置页的按钮）
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    // unminimize / set_focus 在移动端不存在，必须按目标门控
    #[cfg(desktop)]
    if let Some(w) = tauri::Manager::get_webview_window(&app, "main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    #[cfg(not(desktop))]
    let _ = app;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 托盘：关窗不退出，任务栏右侧常驻；悬停显示实时简讯
            #[cfg(desktop)]
            {
                if let Err(e) = tray::init(app.handle()) {
                    eprintln!("[Geek Space] 托盘初始化失败: {e}");
                }
            }
            #[cfg(not(desktop))]
            let _ = app;
            // 采集器在独立线程初始化：WMI / Get-Counter 查询耗时 1~3 秒，
            // 放到后台避免阻塞窗口首帧显示。
            std::thread::spawn(|| {
                collector::init();
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 点右上角 × 时缩到托盘而不是退出；用户可在设置里关掉这个行为
            #[cfg(desktop)]
            {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.label() == "main" && tray::close_to_tray() {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
            #[cfg(not(desktop))]
            let _ = (window, event);
        })
        .invoke_handler(tauri::generate_handler![
            device_profile,
            live_snapshot,
            sensor_list,
            startup_items,
            driver_list,
            top_processes,
            capabilities,
            set_close_to_tray,
            show_main_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running Geek Space");
}
