#![allow(dead_code)]
// ============================================================
// 极客空间 Geek Space — Android / Linux 硬件采集层
// ------------------------------------------------------------
// 移动端没有 WMI。这里改读 /proc、/sys，以及 Android 的
// getprop / wm 只读命令，**合成一份与 Windows WMI 完全同构的 JSON**，
// 交给 collector::build_profile 复用同一套解析逻辑 —— 两份平台
// 的档案结构、界面呈现因此天然一致。
//
// 原则不变：读不到的字段一律留空，界面显示「—」，绝不伪造。
// 例如 Android 非 root 环境拿不到硬盘 SMART 健康度、GPU 温度，
// 这些就诚实地空着，而不是填一个好看的假数字。
//
// 该模块在 Windows 上也会编译（便于本机 cargo check 校验），
// 但入口只在非 Windows 分支被调用。
// ============================================================

use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::process::Command;

// ------------------------------------------------------------
// 基础读取
// ------------------------------------------------------------
fn read_trim(path: &str) -> Option<String> {
    let s = fs::read_to_string(path).ok()?;
    let t = s.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn read_num(path: &str) -> Option<f64> {
    read_trim(path)?.parse::<f64>().ok().filter(|v| v.is_finite())
}

/// 执行只读命令，整体输出（失败返回 None）
fn cmd_out(prog: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(prog).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// 执行只读命令，取第一行
fn cmd_line(prog: &str, args: &[&str]) -> Option<String> {
    let s = cmd_out(prog, args)?;
    s.lines().next().map(|l| l.trim().to_string()).filter(|l| !l.is_empty())
}

/// Android getprop。非 Android 平台直接返回 None。
fn getprop(key: &str) -> Option<String> {
    #[cfg(target_os = "android")]
    {
        // 优先绝对路径，避免 PATH 差异
        for prog in ["/system/bin/getprop", "getprop"] {
            if let Some(v) = cmd_line(prog, &[key]) {
                let v = v.trim().to_string();
                if !v.is_empty() && v != "unknown" && v != "null" {
                    return Some(v);
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = key;
        None
    }
}

/// Linux DMI（主板/整机信息）。Android 上通常不存在或被限制，返回 None。
fn dmi(name: &str) -> Option<String> {
    let v = read_trim(&format!("/sys/class/dmi/id/{}", name))?;
    let t = v.trim();
    if t.is_empty() || t == "None" {
        None
    } else {
        Some(t.to_string())
    }
}

// ------------------------------------------------------------
// CPU
// ------------------------------------------------------------
/// 内核缓存大小字符串（"256K" / "2M" / "8192K"）→ KB
fn parse_cache_kb(s: &str) -> u64 {
    let s = s.trim();
    if let Some(n) = s.strip_suffix(['K', 'k']) {
        n.trim().parse::<u64>().unwrap_or(0)
    } else if let Some(n) = s.strip_suffix(['M', 'm']) {
        n.trim().parse::<u64>().unwrap_or(0) * 1024
    } else {
        s.parse::<u64>().unwrap_or(0)
    }
}

/// 从 /sys/devices/system/cpu/cpu0/cache 读 L2 / L3（KB）
fn cpu_cache_kb() -> (u64, u64) {
    let (mut l2, mut l3) = (0u64, 0u64);
    for i in 0..8 {
        let base = format!("/sys/devices/system/cpu/cpu0/cache/index{}", i);
        let level = match read_trim(&format!("{}/level", base)).and_then(|s| s.parse::<u32>().ok()) {
            Some(v) => v,
            None => continue,
        };
        let ty = read_trim(&format!("{}/type", base)).unwrap_or_default();
        // 只取指令/数据/统一缓存，跳过 "Instruction" 之外的噪声项
        if ty == "Instruction" {
            continue;
        }
        let size = match read_trim(&format!("{}/size", base)) {
            Some(v) => parse_cache_kb(&v),
            None => continue,
        };
        if level == 2 && size > l2 {
            l2 = size;
        }
        if level == 3 && size > l3 {
            l3 = size;
        }
    }
    (l2, l3)
}

fn cpu_entry() -> Value {
    let info = fs::read_to_string("/proc/cpuinfo").unwrap_or_default();

    let mut model = String::new();
    let mut vendor = String::new();
    let mut logical: u32 = 0;
    let mut pairs: HashSet<(String, String)> = HashSet::new();
    let mut cur_phys: Option<String> = None;
    let mut cur_core: Option<String> = None;

    for line in info.lines() {
        let Some((k, v)) = line.split_once(':') else { continue };
        let (k, v) = (k.trim(), v.trim());
        match k {
            "processor" => {
                if let (Some(p), Some(c)) = (cur_phys.take(), cur_core.take()) {
                    pairs.insert((p, c));
                }
                logical += 1;
            }
            "physical id" => cur_phys = Some(v.to_string()),
            "core id" => cur_core = Some(v.to_string()),
            "model name" | "Hardware" | "Model" | "machine" => {
                if model.is_empty() && !v.is_empty() {
                    model = v.to_string();
                }
            }
            "vendor_id" => {
                if vendor.is_empty() {
                    vendor = match v {
                        "GenuineIntel" => "Intel".to_string(),
                        "AuthenticAMD" => "AMD".to_string(),
                        other => other.to_string(),
                    };
                }
            }
            "CPU implementer" => {
                if vendor.is_empty() {
                    // ARM 的实现者编码，常见 0x41=ARM, 0x51=Qualcomm, 0x4d/0x35=Apple/MTK
                    vendor = match v.to_ascii_lowercase().as_str() {
                        "0x41" => "ARM".to_string(),
                        "0x51" => "Qualcomm".to_string(),
                        "0x53" => "Samsung".to_string(),
                        "0x56" => "Marvell".to_string(),
                        "0x69" => "Intel".to_string(),
                        _ => String::new(),
                    };
                }
            }
            _ => {}
        }
    }
    if let (Some(p), Some(c)) = (cur_phys, cur_core) {
        pairs.insert((p, c));
    }
    let phys = if pairs.is_empty() { logical } else { pairs.len() as u32 };

    // 最大频率：优先 cpufreq，退回 cpuinfo 里的 "cpu MHz"
    let max_khz = read_num("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq")
        .or_else(|| read_num("/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq"));
    let boost_ghz = match max_khz {
        Some(k) if k > 0.0 => k / 1_000_000.0,
        _ => 0.0,
    };
    let min_khz = read_num("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq");
    let base_ghz = match min_khz {
        Some(k) if k > 0.0 => k / 1_000_000.0,
        _ => 0.0,
    };

    let (l2, l3) = cpu_cache_kb();
    // Linux 的 index2 是**每核** L2，与 Windows WMI 的"总量"口径不同，
    // 换算成总量以便两端显示一致。
    let l2_total = if l2 > 0 { l2 * phys.max(1) as u64 } else { 0 };

    json!({
        "Name": if model.is_empty() { Value::Null } else { Value::String(model) },
        "Manufacturer": vendor,
        "NumberOfCores": phys,
        "NumberOfLogicalProcessors": logical.max(1),
        "MaxClockSpeed": if boost_ghz > 0.0 { (boost_ghz * 1000.0).round() } else { 0.0 },
        "MinClockSpeed": if base_ghz > 0.0 { (base_ghz * 1000.0).round() } else { 0.0 },
        "L2CacheSize": l2_total,
        "L3CacheSize": l3,
        "SocketDesignation": "",
        "DataWidth": 64,
        "VirtualizationFirmwareEnabled": false,
    })
}

// ------------------------------------------------------------
// GPU（尽力而为）
// ------------------------------------------------------------
fn gpu_entries() -> Vec<Value> {
    let mut name = String::new();
    let mut processor = String::new();

    // Qualcomm KGSL
    if let Some(v) = read_trim("/sys/class/kgsl/kgsl-3d0/gpu_model") {
        name = v;
    }
    // 通用：/sys/class/drm/card0/device/uevent 里的 DRIVER / PCI_ID
    if name.is_empty() {
        if let Some(v) = read_trim("/sys/class/drm/card0/device/uevent") {
            for line in v.lines() {
                if let Some(d) = line.strip_prefix("DRIVER=") {
                    processor = d.trim().to_string();
                }
            }
        }
    }
    // Android：从 EGL 实现推断大类
    if name.is_empty() {
        if let Some(hw) = getprop("ro.hardware.egl") {
            name = match hw.to_ascii_lowercase().as_str() {
                "adreno" => "Qualcomm Adreno".to_string(),
                "mali" => "ARM Mali".to_string(),
                "powervr" => "Imagination PowerVR".to_string(),
                "nv" | "tegra" => "NVIDIA GPU".to_string(),
                other => other.to_string(),
            };
        }
    }
    // 最后兜底：SurfaceFlinger 的 GLES 字符串通常带完整型号
    if name.is_empty() {
        if let Some(v) = cmd_line(
            "/system/bin/sh",
            &["-c", "dumpsys SurfaceFlinger 2>/dev/null | grep -m1 -i GLES"],
        ) {
            if let Some((_, r)) = v.split_once(':') {
                let r = r.trim();
                if !r.is_empty() {
                    name = r.to_string();
                }
            }
        }
    }

    // 分辨率：wm size 通常即使在非 root 下也可读
    let mut rw = 0u32;
    let mut rh = 0u32;
    for prog in ["/system/bin/wm", "wm"] {
        if let Some(out) = cmd_out(prog, &["size"]) {
            for line in out.lines() {
                if let Some(p) = line.find("Physical size:") {
                    let v = line[p + "Physical size:".len()..].trim();
                    if let Some((a, b)) = v.split_once('x') {
                        rw = a.trim().parse().unwrap_or(0);
                        rh = b.trim().parse().unwrap_or(0);
                    }
                }
            }
            if rw > 0 {
                break;
            }
        }
    }

    if name.is_empty() && rw == 0 {
        // 完全没有可读信息：不产出条目，界面显示「—」
        return Vec::new();
    }

    vec![json!({
        "Name": name,
        "DriverVersion": "",
        "AdapterRAM": 0,
        "CurrentHorizontalResolution": rw,
        "CurrentVerticalResolution": rh,
        "CurrentRefreshRate": 0,
        "CurrentBitsPerPixel": 32,
        "VideoProcessor": processor,
        "AdapterCompatibility": "",
        "PNPDeviceID": "",
        "VideoModeDescription": "",
    })]
}

// ------------------------------------------------------------
// 整机 / 主板 / 固件 / 系统
// ------------------------------------------------------------
fn sys_entry(mem_total_kb: u64) -> Value {
    let manufacturer = getprop("ro.product.manufacturer")
        .or_else(|| getprop("ro.product.brand"))
        .or_else(|| dmi("sys_vendor"))
        .unwrap_or_default();
    let model = getprop("ro.product.model").or_else(|| dmi("product_name")).unwrap_or_default();
    json!({
        "Manufacturer": manufacturer,
        "Model": model,
        "SystemType": if cfg!(target_pointer_width = "64") { "x64-based" } else { "ARM" },
        "TotalPhysicalMemory": mem_total_kb as f64 * 1024.0,
        "NumberOfProcessors": 1,
    })
}

fn board_entry() -> Value {
    json!({
        "Manufacturer": getprop("ro.board.platform").unwrap_or_default(),
        "Product": getprop("ro.product.board").or_else(|| dmi("board_name")).unwrap_or_default(),
        "Version": getprop("ro.boot.hardware").or_else(|| dmi("board_vendor")).unwrap_or_default(),
        "SerialNumber": getprop("ro.serialno").or_else(|| dmi("product_serial")).unwrap_or_default(),
    })
}

fn bios_entry() -> Value {
    json!({
        "SMBIOSBIOSVersion": getprop("ro.bootloader")
            .or_else(|| dmi("bios_version"))
            .unwrap_or_default(),
        "Manufacturer": getprop("ro.product.brand")
            .or_else(|| dmi("bios_vendor"))
            .unwrap_or_default(),
        // 已是 yyyy-MM-dd，无需再解析
        "ReleaseDate": dmi("bios_date").unwrap_or_default(),
    })
}

fn os_entry() -> Value {
    let release = getprop("ro.build.version.release");
    let sdk = getprop("ro.build.version.sdk");
    let (caption, build) = match (release, sdk) {
        (Some(r), Some(s)) => (format!("Android {}", r), format!("API {}", s)),
        (Some(r), None) => (format!("Android {}", r), String::new()),
        _ => {
            // Linux 桌面：读 os-release
            let pretty = read_trim("/etc/os-release")
                .and_then(|s| {
                    s.lines()
                        .find(|l| l.starts_with("PRETTY_NAME="))
                        .map(|l| l.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string())
                })
                .unwrap_or_default();
            let kern = read_trim("/proc/sys/kernel/osrelease").unwrap_or_default();
            (pretty, kern)
        }
    };
    json!({
        "Caption": caption,
        "Version": getprop("ro.build.version.incremental").unwrap_or_default(),
        "BuildNumber": build,
        "OSArchitecture": if cfg!(target_pointer_width = "64") { "64" } else { "32" },
        "InstallDate": "",
    })
}

fn chassis_entry() -> Value {
    // Android 交回移动形态；build_profile 会据此设置 is_laptop
    json!([{ "ChassisTypes": [30], "SMBIOSAssetTag": "" }])
}

// ------------------------------------------------------------
// 显示器
// ------------------------------------------------------------
fn monitor_entries() -> Vec<Value> {
    let mut model = String::new();

    #[cfg(target_os = "android")]
    {
        if let Some(b) = getprop("ro.product.model") {
            model = b;
        }
    }

    if model.is_empty() {
        if let Some(b) = dmi("product_name") {
            model = b;
        }
    }

    if model.is_empty() {
        return Vec::new();
    }

    // 把型号名转成 WmiMonitorID 那样的字符码数组，复用同一套解析
    let codes: Vec<u32> = model.chars().take(13).map(|c| c as u32).collect();
    vec![json!({
        "UserFriendlyName": codes,
        "ManufacturerName": model.chars().take(0).map(|c| c as u32).collect::<Vec<u32>>(),
        "ProductCodeID": [],
        "WeekOfManufacture": 0,
        "YearOfManufacture": 0,
    })]
}

// ------------------------------------------------------------
// 存储：sysinfo 提供跨平台的挂载点/容量
// ------------------------------------------------------------
fn storage_entries() -> (Vec<Value>, Vec<Value>, i32) {
    use sysinfo::DiskKind;

    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut vols: Vec<Value> = Vec::new();
    let mut phys: Vec<Value> = Vec::new();
    let mut sys_idx: i32 = -1;
    // 同一分区可能被多次挂载（Android 的 /data 与 /storage/emulated/0），
    // 按「总量+可用量」去重，避免界面出现几个一模一样的条目。
    let mut seen: Vec<(u64, u64)> = Vec::new();
    let mut idx: i32 = 0;

    for d in disks.list() {
        let mp = d.mount_point().to_string_lossy().to_string();
        let total = d.total_space();
        if total == 0 {
            continue;
        }
        if mp.starts_with("/proc")
            || mp.starts_with("/sys")
            || mp.starts_with("/dev")
            || mp.starts_with("/apex")
            || mp.starts_with("/mnt/vendor")
        {
            continue;
        }
        let avail = d.available_space();
        let key = (total, avail);
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);

        let is_sys = mp == "/" || mp == "/data" || mp == "/system";
        let fs = d.file_system().to_string_lossy().to_string();
        let kind = match d.kind() {
            DiskKind::SSD => "ssd",
            DiskKind::HDD => "hdd",
            _ => {
                if fs.contains("f2fs") || fs.contains("ext4") {
                    "ssd"
                } else {
                    "ssd"
                }
            }
        };
        let label = if is_sys { "内部存储" } else { "" };

        vols.push(json!({
            "letter": mp,
            "label": label,
            "fs": fs,
            "size": total as f64,
            "free": avail as f64,
            "type": if d.is_removable() { "Removable" } else { "Fixed" },
            "disk": idx,
            "system": is_sys,
        }));

        phys.push(json!({
            "model": if is_sys {
                format!("{} ({})", label, mp)
            } else {
                mp.clone()
            },
            "bus": "",
            "media": if kind == "ssd" { "SSD" } else { "HDD" },
            "size": total as f64,
            "cap": total as f64,
            "used": total.saturating_sub(avail) as f64,
            // 非 root 拿不到 SMART，诚实地留空 → 界面显示「—」
            "health": "",
            "serial": "",
            "disk": idx,
            "system": is_sys,
        }));

        if is_sys {
            sys_idx = idx;
        }
        idx += 1;
    }

    (vols, phys, sys_idx)
}

// ------------------------------------------------------------
// 电池
// ------------------------------------------------------------
const BAT: &str = "/sys/class/power_supply/battery";

fn battery_present() -> bool {
    Path::new(BAT).exists()
}

/// (设计容量 mWh, 满充容量 mWh, 循环次数)
fn battery_static() -> (Option<f64>, Option<f64>, Option<u32>) {
    // 能量类节点单位直接是 µWh
    if let Some(e) = read_num(&format!("{}/energy_full_design", BAT)) {
        let full = read_num(&format!("{}/energy_full", BAT));
        let cyc = read_num(&format!("{}/cycle_count", BAT)).map(|v| v as u32);
        return (
            Some(e / 1000.0),
            full.map(|v| v / 1000.0),
            cyc.filter(|v| *v > 0),
        );
    }
    // 电荷类节点单位是 µAh，乘标称电压才是 Wh
    let volt = read_num(&format!("{}/voltage_min_design", BAT))
        .or_else(|| read_num(&format!("{}/voltage_now", BAT)))
        .map(|v| v / 1_000_000.0)
        .filter(|v| *v > 2.0 && *v < 6.0)
        .unwrap_or(3.85);
    if let Some(c) = read_num(&format!("{}/charge_full_design", BAT)) {
        let full = read_num(&format!("{}/charge_full", BAT));
        let cyc = read_num(&format!("{}/cycle_count", BAT)).map(|v| v as u32);
        return (
            Some(c / 1_000.0 * volt),
            full.map(|v| v / 1_000.0 * volt),
            cyc.filter(|v| *v > 0),
        );
    }
    (None, None, None)
}

fn battery_entries() -> Vec<Value> {
    if !battery_present() {
        return Vec::new();
    }
    vec![json!({
        "EstimatedChargeRemaining": 0,
        "BatteryStatus": 0,
        "Chemistry": "",
        "DesignCapacity": 0,
        "FullChargeCapacity": 0,
    })]
}

/// 电池电量与状态
pub fn battery() -> (Option<f64>, String) {
    if !battery_present() {
        return (None, "none".into());
    }
    let pct = read_num(&format!("{}/capacity", BAT)).filter(|v| (0.0..=100.0).contains(v));
    let status = read_trim(&format!("{}/status", BAT))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let state = match status.as_str() {
        "charging" => "charging",
        "full" => "full",
        "discharging" => "discharging",
        "not charging" => "charging",
        _ => "unknown",
    };
    (pct, state.to_string())
}

/// CPU / SoC 温度（°C）
pub fn cpu_temp() -> Option<f64> {
    let mut best_pri = 9u8;
    let mut best: Option<f64> = None;
    for i in 0..40 {
        let base = format!("/sys/class/thermal/thermal_zone{}", i);
        let ty = match read_trim(&format!("{}/type", base)) {
            Some(t) => t.to_ascii_lowercase(),
            None => continue,
        };
        let raw = match read_num(&format!("{}/temp", base)) {
            Some(v) => v,
            None => continue,
        };
        // 多数平台是毫摄氏度，少数直接是摄氏度
        let c = if raw > 1000.0 { raw / 1000.0 } else { raw };
        if !(5.0..=120.0).contains(&c) {
            continue;
        }
        let pri = if ty.contains("cpu") || ty.contains("soc") || ty.contains("tsens") || ty.contains("ap") || ty.contains("cluster") {
            0
        } else if ty.contains("gpu") || ty.contains("battery") || ty.contains("charger") || ty.contains("chg") {
            2
        } else {
            1
        };
        // 只接受 CPU 相关或中性传感器，绝不用电池温度冒充 CPU 温度
        if pri == 2 {
            continue;
        }
        if pri < best_pri {
            best_pri = pri;
            best = Some(c);
        } else if pri == best_pri {
            best = Some(best.map_or(c, |b| b.max(c)));
        }
    }
    best
}

/// 传感器列表（温度/电压）
pub fn sensors() -> Vec<crate::collector::SensorReading> {
    use crate::collector::SensorReading;
    let mut out: Vec<SensorReading> = Vec::new();

    for i in 0..40 {
        let base = format!("/sys/class/thermal/thermal_zone{}", i);
        let ty = match read_trim(&format!("{}/type", base)) {
            Some(t) => t,
            None => continue,
        };
        let raw = match read_num(&format!("{}/temp", base)) {
            Some(v) => v,
            None => continue,
        };
        let c = if raw > 1000.0 { raw / 1000.0 } else { raw };
        if !(5.0..=120.0).contains(&c) {
            continue;
        }
        out.push(SensorReading {
            name: ty,
            kind: "温度".into(),
            unit: "°C".into(),
            value: Some(c),
        });
    }

    if battery_present() {
        if let Some(t) = read_num(&format!("{}/temp", BAT)) {
            // 常见单位是 0.1°C
            let c = if t > 120.0 { t / 10.0 } else { t };
            if (0.0..=90.0).contains(&c) {
                out.push(SensorReading {
                    name: "Battery".into(),
                    kind: "温度".into(),
                    unit: "°C".into(),
                    value: Some(c),
                });
            }
        }
        if let Some(v) = read_num(&format!("{}/voltage_now", BAT)) {
            let volt = (v / 1_000_000.0 * 1000.0).round() / 1000.0;
            if volt > 0.0 {
                out.push(SensorReading {
                    name: "Battery Voltage".into(),
                    kind: "电压".into(),
                    unit: "V".into(),
                    value: Some(volt),
                });
            }
        }
        if let Some(a) = read_num(&format!("{}/current_now", BAT)) {
            let amp = (a / 1_000_000.0 * 1000.0).round() / 1000.0;
            out.push(SensorReading {
                name: "Battery Current".into(),
                kind: "电流".into(),
                unit: "A".into(),
                value: Some(amp.abs()),
            });
        }
    }

    out.truncate(40);
    out
}

// ------------------------------------------------------------
// 对外：合成与 Windows 同构的静态档案 JSON
// ------------------------------------------------------------
pub fn static_json() -> Option<Value> {
    // 内存总量：/proc/meminfo 的 MemTotal（KB）
    let mem_total_kb = read_trim("/proc/meminfo")
        .and_then(|s| {
            s.lines().find(|l| l.starts_with("MemTotal:")).and_then(|l| {
                l.split_whitespace()
                    .nth(1)
                    .and_then(|v| v.parse::<u64>().ok())
            })
        })
        .unwrap_or(0);

    let (vols, phys, _sys_idx) = storage_entries();
    let (design, full, cycles) = battery_static();

    let mut o = serde_json::Map::new();
    o.insert("cpu".into(), json!([cpu_entry()]));
    // 内存条明细在移动端不可得（无 SMBIOS），留空由 sys 提供总量
    o.insert("mem".into(), json!([]));
    o.insert("gpu".into(), Value::Array(gpu_entries()));
    o.insert("board".into(), json!([board_entry()]));
    o.insert("bios".into(), json!([bios_entry()]));
    o.insert("os".into(), json!([os_entry()]));
    o.insert("sys".into(), json!([sys_entry(mem_total_kb)]));
    o.insert("chassis".into(), chassis_entry());
    o.insert("battery".into(), Value::Array(battery_entries()));
    o.insert("batDesign".into(), json!([{ "DesignedCapacity": design.unwrap_or(0.0) }]));
    o.insert("batFull".into(), json!([{ "FullChargedCapacity": full.unwrap_or(0.0) }]));
    o.insert("batCycle".into(), json!([{ "CycleCount": cycles.unwrap_or(0) }]));
    o.insert("monitor".into(), Value::Array(monitor_entries()));
    o.insert("monSize".into(), json!([]));
    o.insert("monConn".into(), json!([]));
    o.insert("volume".into(), Value::Array(vols));
    o.insert("disk".into(), Value::Array(phys));

    Some(Value::Array(vec![Value::Object(o)]))
}
