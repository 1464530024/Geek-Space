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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // 采集器在独立线程初始化：WMI / Get-Counter 查询耗时 1~3 秒，
            // 放到后台避免阻塞窗口首帧显示。
            std::thread::spawn(|| {
                collector::init();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            device_profile,
            live_snapshot,
            sensor_list,
            startup_items,
            driver_list,
            top_processes,
            capabilities
        ])
        .run(tauri::generate_context!())
        .expect("error while running Geek Space");
}
