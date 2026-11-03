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

#[tauri::command]
fn device_profile() -> DeviceProfile {
    collector::get_profile()
}

#[tauri::command]
fn live_snapshot() -> LiveSnapshot {
    collector::get_live()
}

#[tauri::command]
fn sensor_list() -> Vec<SensorReading> {
    collector::get_sensors()
}

#[tauri::command]
fn startup_items() -> Vec<StartupItem> {
    collector::get_startup_items()
}

#[tauri::command]
fn driver_list() -> Vec<DriverItem> {
    collector::get_drivers()
}

#[tauri::command]
fn top_processes() -> Vec<ProcessInfo> {
    collector::get_top_processes()
}

#[tauri::command]
fn capabilities() -> serde_json::Value {
    collector::capabilities()
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
