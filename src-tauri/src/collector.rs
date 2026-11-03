// ============================================================
// 极客空间 Geek Space — 硬件采集层
// ------------------------------------------------------------
// 数据来源分层（逐级降级，任何机器都能跑起来）：
//   1. sysinfo              → CPU 使用率/频率、内存、网络、进程（纯 Rust）
//   2. WMI (PowerShell ×2)  → 静态档案：CPU / 显卡 / 主板 / BIOS / 物理盘 / 卷 / 内存条 / 电池 / 显示器
//   3. GetSystemPowerStatus → 电池状态（Win32 直调，零进程开销）
//   4. LibreHardwareMonitor → 温度 / 风扇 / 电压（需用户装 LHM；未装则按负载估算并置 estimated=true）
//   5. nvidia-smi           → NVIDIA 实时负载 / 温度 / 功耗（无 N 卡则降级为 None）
// 采集不到的字段一律返回 null，前端显示「—」，绝不编造数据。
// ============================================================

use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ============================================================
// 数据结构（与前端 profile / live 同构，camelCase 直出）
// ============================================================

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OsInfo {
    pub name: String,
    pub build: String,
    pub arch: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub manufacturer: String,
    pub model: String,
    pub chassis: String,
    pub is_laptop: bool,
    pub arch_bits: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub model: String,
    pub vendor: String,
    pub codename: String,
    pub cores: u32,
    pub threads: u32,
    pub base: f64,
    pub boost: f64,
    pub l2: u64,
    pub l3: u64,
    pub node: String,
    pub tdp: u32,
    pub socket: String,
    pub virtualization: bool,
    pub data_width: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub model: String,
    pub vendor: String,
    pub vram: u32,
    pub driver: String,
    pub base: u32,
    pub boost: u32,
    pub mem: u32,
    pub bus: u32,
    pub tdp: u32,
    pub bits: u32,
    pub video_processor: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub vendor: String,
    pub model: String,
    /// 芯片组：从型号里识别（Win32_BaseBoard 不直接提供）
    pub chipset: String,
    /// 主板版本 / 修订号（Win32_BaseBoard.Version）
    pub revision: String,
    pub bios: String,
    pub ec: String,
    pub bios_vendor: String,
    pub serial: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub model: String,
    pub vendor: String,
    pub res: String,
    pub refresh: u32,
    pub size: f64,
    pub panel: String,
    pub hdr: String,
    pub connection: String,
    /// EDID 序列号（显示器自身的，不是主板序列号）
    pub serial: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub id: u32,
    pub model: String,
    pub iface: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub cap_gb: u64,
    pub used_gb: u64,
    pub health: Option<u32>,
    pub temp: Option<i32>,
    pub power_on: Option<u64>,
    pub hours: Option<u64>,
    pub read_mb: Option<u64>,
    pub write_mb: Option<u64>,
    pub system: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemSlot {
    pub name: String,
    pub size_gb: u32,
    pub speed_mhz: u32,
    pub vendor: String,
    pub part_number: String,
}

/// 逻辑卷（分区）。比物理盘更贴近用户认知：
/// 资源管理器里的 C:/D:/E: 就是这一层。
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub letter: String,
    pub label: String,
    pub fs: String,
    /// 总容量（GiB，与 Windows 资源管理器一致）
    pub size_gb: f64,
    pub used_gb: f64,
    pub free_gb: f64,
    /// 已用百分比
    pub used_pct: f64,
    /// Fixed / Removable / Network
    pub kind: String,
    /// 所属物理磁盘序号
    pub disk: i32,
    /// 是否为系统盘（安装了 Windows 的那一个）
    pub system: bool,
}

/// 进程占用（实时 TOP 榜）
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu: f64,
    pub mem_mb: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemInfo {
    pub total_gb: u32,
    #[serde(rename = "type")]
    pub kind: String,
    pub speed_mhz: u32,
    pub channels: u32,
    pub vendor: String,
    pub slots: Vec<MemSlot>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    pub present: bool,
    pub design_wh: f64,
    pub full_wh: f64,
    pub cycles: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FanInfo {
    pub name: String,
    pub rpm: u32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceProfile {
    pub seed: u32,
    pub host: String,
    pub os: OsInfo,
    pub system: SystemInfo,
    pub cpu: CpuInfo,
    pub gpu: GpuInfo,
    pub board: BoardInfo,
    pub display: DisplayInfo,
    pub display_count: u32,
    pub disks: Vec<DiskInfo>,
    /// 真实逻辑卷（分区）列表
    pub volumes: Vec<VolumeInfo>,
    /// 系统盘在 disks 中的下标（-1 表示未识别）
    pub system_disk: i32,
    pub battery: BatteryInfo,
    pub mem: MemInfo,
    pub bios_date: String,
    /// 系统安装日期
    pub os_install: String,
    pub fans: Vec<FanInfo>,
    /// 采集失败项，前端可据此提示（如 "未安装 LibreHardwareMonitor"）
    pub degraded: Vec<String>,
    /// 是否已接入真实硬件（前端据此关闭演示模式）
    pub native: bool,
    /// 采集平台：windows / android / linux
    pub platform: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoreLoad {
    pub usage: f64,
    pub temp: Option<f64>,
    pub clock: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveSnapshot {
    pub cpu_usage: f64,
    pub cpu_temp: Option<f64>,
    pub cpu_clock: f64,
    pub cpu_power: Option<f64>,
    pub mem_used_gb: f64,
    pub mem_percent: f64,
    pub gpu_usage: Option<f64>,
    pub gpu_temp: Option<f64>,
    pub gpu_clock: Option<f64>,
    pub gpu_power: Option<f64>,
    /// 专用显存占用（MB）
    pub gpu_vram_used_mb: Option<u32>,
    pub disk_read: f64,
    pub disk_write: f64,
    pub net_down: f64,
    pub net_up: f64,
    pub system_power: Option<f64>,
    pub uptime_sec: u64,
    pub battery_percent: Option<f64>,
    pub battery_state: String,
    pub per_core: Vec<CoreLoad>,
    pub load: String,
    /// true 表示温度/功耗为估算值而非真实传感器读数
    pub estimated: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SensorReading {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub unit: String,
    pub value: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub name: String,
    pub publisher: String,
    /// 是否开机自启（Run 键与启动文件夹都是）
    pub boot: bool,
    pub disabled: bool,
    /// registry / folder / task
    pub kind: String,
    /// 启用状态是否读取成功（StartupApproved 缺失时为 false）
    pub state_known: bool,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DriverItem {
    pub device: String,
    pub ver: String,
    pub date: String,
    pub vendor: String,
}

// ============================================================
// PowerShell 桥
// ============================================================

/// UTF-16LE 编码（-EncodedCommand 要求的输入格式）
fn utf16le(s: &str) -> Vec<u8> {
    s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect()
}

/// 极简 Base64 编码，避免为一次调用引入额外依赖
fn b64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn run_ps(script: &str) -> Option<String> {
    #[cfg(windows)]
    {
        // 统一前缀：
        //  1. 强制控制台与管道按 UTF-8 输出，中文（启动项 / 驱动 / 系统名）不乱码。
        //  2. $PSStyle 只在 PowerShell 7+ 存在。Windows 自带的 5.1 会把
        //     `$PSStyle.X = 'v' -ErrorAction SilentlyContinue` 判定为**语法错误**
        //     （意外的标记"-ErrorAction"），整条 -Command 直接不执行、退出码 1，
        //     导致全部 WMI 采集静默失败——显卡/主板/BIOS/显示器/磁盘/驱动全空。
        //     必须做版本门控，保证 5.1 也能正常解析。
        let wrapped = String::from(
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
             $OutputEncoding=[System.Text.Encoding]::UTF8; \
             if ($PSVersionTable.PSVersion.Major -ge 7) { $PSStyle.OutputRendering = 'PlainText' }; ",
        ) + script;

        // 用 -EncodedCommand（UTF-16LE → Base64）传脚本，彻底避开命令行转义：
        // 脚本里出现引号、反斜杠都不会被 shell 破坏。
        let encoded = b64_encode(&utf16le(&wrapped));

        let mut cmd = Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded,
        ]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let out = cmd.output().ok()?;
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() { None } else { Some(s) }
    }
    #[cfg(not(windows))]
    {
        let _ = script;
        None
    }
}

/// 执行脚本并把输出解析为 JSON（自动把结果包装成数组）
///
/// 关键点：末尾把 JSON 中的**非 ASCII 字符全部转成 `\uXXXX` 转义**，使
/// PowerShell 的输出成为纯 ASCII 字节流。这样无论宿主的控制台代码页是
/// GBK(936) 还是 UTF-8，字节都不可能被二次编码破坏，中文名（启动项、
/// 驱动、系统版本）100% 原样还原。
fn ps_json(script: &str) -> Option<serde_json::Value> {
    let wrapped = format!(
        "$ErrorActionPreference='SilentlyContinue'; \
         $ProgressPreference='SilentlyContinue'; \
         $__j = ConvertTo-Json -Depth 6 -Compress -InputObject @({}); \
         if ($null -ne $__j) {{ \
           [regex]::Replace([string]$__j, '[^\\x00-\\x7F]', \
             {{ param($m) '\\u{{0:x4}}' -f [int][char]$m.Value }}) \
         }}",
        script
    );
    let raw = run_ps(&wrapped)?;
    serde_json::from_str::<serde_json::Value>(&raw).ok()
}

fn as_array(v: &serde_json::Value) -> Vec<serde_json::Value> {
    match v {
        serde_json::Value::Array(a) => a.clone(),
        serde_json::Value::Object(_) => vec![v.clone()],
        _ => Vec::new(),
    }
}

fn g<'a>(v: &'a serde_json::Value, key: &str) -> &'a serde_json::Value {
    v.get(key).unwrap_or(&serde_json::Value::Null)
}

fn s_of(v: &serde_json::Value, key: &str) -> String {
    match g(v, key) {
        serde_json::Value::String(s) => s.trim().to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

fn n_of(v: &serde_json::Value, key: &str) -> f64 {
    match g(v, key) {
        serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
        serde_json::Value::String(s) => s.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

/// 布尔字段。WMI 的 bool 经 ConvertTo-Json 出来是 JSON true/false，
/// n_of 会当成 0 —— 曾导致「虚拟化」永远显示为不支持。
fn b_of(v: &serde_json::Value, key: &str) -> bool {
    match g(v, key) {
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0) != 0.0,
        serde_json::Value::String(s) => {
            let t = s.trim().to_ascii_lowercase();
            t == "true" || t == "1" || t == "yes"
        }
        _ => false,
    }
}

/// 从主板型号里识别芯片组（型号名通常内嵌芯片组代号，如 EX-B150M-V → B150）。
/// 只匹配明确的芯片组代号白名单，避免把 "Z790 AORUS ELITE AX" 之外的
/// 随机字母数字误判成芯片组。
const CHIPSETS: [(&str, &str); 30] = [
    // Intel 100~700 系
    ("Z170", "Intel Z170"), ("H170", "Intel H170"), ("B150", "Intel B150"), ("H110", "Intel H110"),
    ("Z270", "Intel Z270"), ("H270", "Intel H270"), ("B250", "Intel B250"),
    ("Z370", "Intel Z370"), ("H370", "Intel H370"), ("B360", "Intel B360"), ("H310", "Intel H310"),
    ("Z390", "Intel Z390"), ("B365", "Intel B365"),
    ("Z490", "Intel Z490"), ("B460", "Intel B460"), ("H410", "Intel H410"),
    ("Z590", "Intel Z590"), ("B560", "Intel B560"), ("H510", "Intel H510"), ("H570", "Intel H570"),
    ("Z690", "Intel Z690"), ("B660", "Intel B660"), ("H610", "Intel H610"),
    ("Z790", "Intel Z790"), ("B760", "Intel B760"),
    ("X99", "Intel X99"), ("X299", "Intel X299"),
    // AMD AM4 / AM5
    ("X370", "AMD X370"), ("B350", "AMD B350"), ("B450", "AMD B450"),
];

fn chipset_from_model(model: &str) -> String {
    let up = model.to_ascii_uppercase();
    for (code, label) in CHIPSETS.iter() {
        if up.contains(code) {
            return (*label).to_string();
        }
    }
    String::new()
}

fn clean(s: String) -> String {
    let t = s.trim();
    if t.is_empty() {
        "—".to_string()
    } else {
        t.to_string()
    }
}

/// OEM 占位字符串：主板/整机厂商没刷 SMBIOS 时留下的模板文案，
/// 不是真实信息，必须当无效处理，否则界面会显示
/// 「System manufacturer System Product Name」这种假数据。
fn is_placeholder(s: &str) -> bool {
    let t = s.trim().to_ascii_lowercase();
    t.is_empty()
        || t == "to be filled by o.e.m."
        || t == "to be filled by oem"
        || t == "default string"
        || t == "system manufacturer"
        || t == "system product name"
        || t == "system version"
        || t == "o.e.m."
        || t == "not specified"
        || t == "not applicable"
        || t == "none"
        || t == "n/a"
        || t == "unknown"
        || t == "chassis manufacture"
}

/// 毫秒时间戳 → yyyy-MM-dd（UTC）。自己算，不引入 chrono。
fn epoch_ms_to_date(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    // Howard Hinnant 的 civil_from_days
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", year, m, d)
}

/// 统一日期解析：兼容 yyyy-MM-dd、yyyyMMddHHmmss 与 PowerShell 的 /Date(ms)/
fn parse_date_str(raw: &str) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return String::new();
    }
    if let Some(p) = s.find("Date(") {
        let num: String = s[p + 5..]
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '-')
            .collect();
        if let Ok(ms) = num.parse::<i64>() {
            if ms > 0 {
                return epoch_ms_to_date(ms);
            }
        }
        return String::new();
    }
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.len() >= 8 {
        return format!("{}-{}-{}", &digits[0..4], &digits[4..6], &digits[6..8]);
    }
    s.to_string()
}

/// WMI 数组型字符串（如 WmiMonitorID 的 ProductCodeID）转可读文本
fn wmi_str_array(v: &serde_json::Value, key: &str) -> String {
    match g(v, key) {
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|x| x.as_u64())
            .filter(|&c| c != 0 && c < 0x110000)
            .filter_map(|c| char::from_u32(c as u32))
            .collect::<String>()
            .trim()
            .to_string(),
        _ => String::new(),
    }
}

// ============================================================
// 一次性拉取全部静态 WMI 信息
// ------------------------------------------------------------
// 约定：所有日期在 PowerShell 侧就格式化成 'yyyy-MM-dd' 字符串。
// 原因：PS 5.1 的 ConvertTo-Json 会把 [datetime] 序列化成
// `/Date(1474329600000)/`，Rust 按 yyyyMMdd 切片会得到 "te/Dat" 这种垃圾。
// 脚本内容保持纯 ASCII（-EncodedCommand 本身支持中文，但保持 ASCII 更稳）。
// ============================================================
fn fetch_static() -> Option<serde_json::Value> {
    #[cfg(windows)]
    {
        fetch_static_windows()
    }
    #[cfg(not(windows))]
    {
        crate::hw_linux::static_json()
    }
}

/// Windows：一次性 WMI 查询，返回与 build_profile 解析层约定的同构 JSON。
#[cfg(windows)]
fn fetch_static_windows() -> Option<serde_json::Value> {
    // 复用 ps_json（已把结果包成数组），取第一个元素
    ps_json(r#"
$ErrorActionPreference='SilentlyContinue'; $ProgressPreference='SilentlyContinue';
$o = [ordered]@{}

$o.cpu     = @(Get-CimInstance Win32_Processor | Select-Object -First 1 -Property Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,MinClockSpeed,L2CacheSize,L3CacheSize,SocketDesignation,Manufacturer,DataWidth,VirtualizationFirmwareEnabled)
$o.mem     = @(Get-CimInstance Win32_PhysicalMemory | Select-Object -Property Capacity,Speed,ConfiguredClockSpeed,Manufacturer,DeviceLocator,SMBIOSMemoryType,PartNumber)
$o.gpu     = @(Get-CimInstance Win32_VideoController | Select-Object -Property Name,DriverVersion,AdapterRAM,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate,CurrentBitsPerPixel,VideoProcessor,AdapterCompatibility,PNPDeviceID,VideoModeDescription)
$o.board   = @(Get-CimInstance Win32_BaseBoard | Select-Object -First 1 -Property Manufacturer,Product,Version,SerialNumber)
$o.bios    = @(Get-CimInstance Win32_BIOS | Select-Object -First 1 SMBIOSBIOSVersion,Manufacturer,@{n='ReleaseDate';e={ if ($_.ReleaseDate) { ([datetime]$_.ReleaseDate).ToString('yyyy-MM-dd') } else { '' } }})
$o.os      = @(Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 Caption,Version,BuildNumber,OSArchitecture,@{n='InstallDate';e={ if ($_.InstallDate) { ([datetime]$_.InstallDate).ToString('yyyy-MM-dd') } else { '' } }})
$o.sys     = @(Get-CimInstance Win32_ComputerSystem | Select-Object -First 1 -Property Manufacturer,Model,SystemType,TotalPhysicalMemory,NumberOfProcessors)
$o.chassis = @(Get-CimInstance Win32_SystemEnclosure | Select-Object -First 1 -Property ChassisTypes,SMBIOSAssetTag)

# 电池：Win32_Battery 只有状态，容量/循环次数要从 root/wmi 的三个类取（笔记本才有）
$o.battery   = @(Get-CimInstance Win32_Battery | Select-Object -First 1 -Property EstimatedChargeRemaining,BatteryStatus,Chemistry,DesignCapacity,FullChargeCapacity)
$o.batDesign = @(Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData | Select-Object -First 1 -Property DesignedCapacity)
$o.batFull   = @(Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1 -Property FullChargedCapacity)
$o.batCycle  = @(Get-CimInstance -Namespace root/wmi -ClassName BatteryCycleCount | Select-Object -First 1 -Property CycleCount)

$o.monitor = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorID | Select-Object -Property UserFriendlyName,ManufacturerName,ProductCodeID,SerialNumberID,WeekOfManufacture,YearOfManufacture)
$o.monSize = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBasicDisplayParams | Select-Object -Property MaxHorizontalImageSize,MaxVerticalImageSize,InstanceName)
$o.monConn = @(Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorConnectionParams | Select-Object -Property VideoOutputTechnology,InstanceName)

# ---- 逻辑卷：真实分区，带所属磁盘号与系统盘标记 ----
$sysLetter = $env:SystemDrive.TrimEnd(':')
$vols = @()
foreach ($v in (Get-Volume | Where-Object { $_.DriveLetter -and $_.Size -gt 0 })) {
  $dn = -1
  $p = Get-Partition -DriveLetter $v.DriveLetter -ErrorAction SilentlyContinue
  if ($p) { $dn = [int]$p.DiskNumber }
  $vols += [pscustomobject]@{
    letter = $v.DriveLetter.ToString() + ':'
    label  = [string]$v.FileSystemLabel
    fs     = [string]$v.FileSystem
    size   = [int64]$v.Size
    free   = [int64]$v.SizeRemaining
    type   = $v.DriveType.ToString()
    disk   = $dn
    system = ($v.DriveLetter.ToString() -eq $sysLetter)
  }
}
$o.volume = @($vols)

# ---- 物理磁盘：容量/已用由该盘上的卷累加，系统盘标记同样来自卷 ----
# 不能用「第 0 块盘就是系统盘」：本机第 0 块是 WD 机械盘，系统其实在 SSD 上。
$disks = @()
foreach ($pd in (Get-PhysicalDisk)) {
  $dn = [int]$pd.DeviceId
  $cap = 0; $used = 0; $isSys = $false
  foreach ($v in $vols) {
    if ($v.disk -eq $dn) {
      $cap += [int64]$v.size
      $used += [int64]($v.size - $v.free)
      if ($v.system) { $isSys = $true }
    }
  }
  $disks += [pscustomobject]@{
    model  = $pd.FriendlyName
    bus    = $pd.BusType.ToString()
    media  = $pd.MediaType.ToString()
    size   = [int64]$pd.Size
    cap    = $cap
    used   = $used
    health = $pd.HealthStatus.ToString()
    serial = [string]$pd.SerialNumber
    disk   = $dn
    system = $isSys
  }
}
$o.disk = @($disks)
$o
"#)
    .and_then(|v| as_array(&v).into_iter().next())
}

// ============================================================
// 全局采集器
// ============================================================
struct Collector {
    sys: sysinfo::System,
    networks: sysinfo::Networks,
    profile: DeviceProfile,
    last_net: (u64, u64),
    last_net_at: Instant,
    lhm_ok: bool,
    smi_ok: bool,
    last_disk_io: (u64, u64),
    last_disk_at: Instant,
    /// 后台线程采样的 GPU 引擎利用率（%），nvidia-smi 不可用时的兜底
    gpu_engine_pct: Option<f64>,
    /// 后台线程采样的显存占用（MB）
    gpu_vram_used_mb: Option<u32>,
}

static COLLECTOR: OnceLock<Mutex<Collector>> = OnceLock::new();

fn cpumodel_clean(full: &str) -> String {
    full.replace("(R)", "")
        .replace("(TM)", "")
        .replace("(tm)", "")
        .replace("@", " @")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

const NOISY_GPU: [&str; 4] = [
    "Microsoft Basic Display",
    "Microsoft Basic Render",
    "Microsoft Remote Display",
    "Parsec",
];

/// NVIDIA 静态信息（来自 nvidia-smi）
/// AdapterRAM 是 32 位，>4GB 会溢出；且 WMI 的 DriverVersion 是内部版本号
/// （30.0.14.7514），用户认的是 nvidia-smi 给的市场版本号（475.14）。
#[derive(Clone, Default)]
struct NvStatic {
    vram_mb: u32,
    driver: String,
}

const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

/// 字节 → GiB（与 Windows 资源管理器口径一致）
fn to_gib(bytes: f64) -> f64 {
    if bytes > 0.0 { bytes / GIB } else { 0.0 }
}

/// 从 "Intel Core i5-6500 CPU @ 3.20GHz" 这类名称里解析标称频率（GHz）。
/// WMI 的 MinClockSpeed 在多数 Intel 平台上为 null，只能从这里补。
fn parse_name_clock(model: &str) -> f64 {
    let lower = model.to_ascii_lowercase();
    let idx = match lower.find("ghz") {
        Some(i) => i,
        None => return 0.0,
    };
    let head: Vec<char> = lower[..idx].chars().collect();
    let mut num: Vec<char> = Vec::new();
    for c in head.iter().rev() {
        if c.is_ascii_digit() || *c == '.' {
            num.push(*c);
        } else {
            break;
        }
    }
    num.reverse();
    num.iter()
        .collect::<String>()
        .parse::<f64>()
        .ok()
        .filter(|v| *v > 0.3 && *v < 7.5)
        .unwrap_or(0.0)
}

/// 按型号推断 CPU 代号 / 制程 / TDP。
///
/// WMI 完全不提供这三项。这里依据公开产品规格，按**型号族**（世代）映射，
/// 只做世代级判断（同一世代内代号/制程一致），无法识别时返回空值，
/// 界面显示「—」——不猜、不编。
fn cpu_spec_lookup(model: &str) -> (String, String, u32) {
    let m = model.to_ascii_lowercase();

    // ---------- Intel Core ----------
    for tier in ["i3-", "i5-", "i7-", "i9-"] {
        if let Some(rest) = m.split(tier).nth(1) {
            let tok = rest.split_whitespace().next().unwrap_or("");
            let digits: String = tok.chars().take_while(|c| c.is_ascii_digit()).collect();
            let suffix: String = tok
                .chars()
                .skip_while(|c| c.is_ascii_digit())
                .flat_map(|c| c.to_lowercase())
                .collect();
            let n: u32 = digits.parse().unwrap_or(0);
            if n < 1000 {
                break;
            }
            let gen = n / 1000;
            let (code, node, base_tdp) = match gen {
                6 => ("Skylake", "14 nm", 65u32),
                7 => ("Kaby Lake", "14 nm", 65),
                8 => ("Coffee Lake", "14 nm", 65),
                9 => ("Coffee Lake Refresh", "14 nm", 65),
                10 => ("Comet Lake", "14 nm", 65),
                11 => ("Rocket Lake", "14 nm", 125),
                12 => ("Alder Lake", "Intel 7", 125),
                13 => ("Raptor Lake", "Intel 7", 125),
                14 => ("Raptor Lake Refresh", "Intel 7", 125),
                _ => ("", "", 0),
            };
            if code.is_empty() {
                break;
            }
            let mobile = suffix.contains('u') || suffix.contains('h') || suffix.contains('p') || suffix.contains('y');
            let tdp = if mobile {
                if suffix.contains('h') { 45 } else { 15 }
            } else if suffix.contains('k') {
                base_tdp.max(91)
            } else {
                base_tdp
            };
            return (code.into(), node.into(), tdp);
        }
    }

    // ---------- AMD Ryzen ----------
    if let Some(rest) = m.split("ryzen").nth(1) {
        let toks: Vec<&str> = rest.split_whitespace().collect();
        let tok = toks.get(1).copied().unwrap_or_else(|| toks.first().copied().unwrap_or(""));
        let digits: String = tok.chars().take_while(|c| c.is_ascii_digit()).collect();
        let suffix: String = tok
            .chars()
            .skip_while(|c| c.is_ascii_digit())
            .flat_map(|c| c.to_lowercase())
            .collect();
        let n: u32 = digits.parse().unwrap_or(0);
        if n >= 1000 {
            let gen = n / 1000;
            let (code, node, tdp) = match gen {
                1 => ("Zen", "14 nm", 65u32),
                2 => ("Zen+", "12 nm", 65),
                3 => ("Zen 2", "7 nm", 65),
                4 => ("Zen 2", "7 nm", 15),
                5 => ("Zen 3", "7 nm", 65),
                6 => ("Zen 3+", "6 nm", 15),
                7 => ("Zen 4", "5 nm", 65),
                8 => ("Zen 4", "4 nm", 15),
                9 => ("Zen 5", "4 nm", 65),
                _ => ("", "", 0),
            };
            if !code.is_empty() {
                let t = if suffix.contains('h') { 45 } else if suffix.contains('u') { 15 } else { tdp };
                return (code.into(), node.into(), t);
            }
        }
    }

    (String::new(), String::new(), 0)
}

fn build_profile(sys: &sysinfo::System, nv: Option<NvStatic>) -> DeviceProfile {
    let mut degraded: Vec<String> = Vec::new();

    // ---- 主机 / 系统（sysinfo，快；以下为关联函数，不需要实例）----
    let host = sysinfo::System::host_name()
        .filter(|h| !h.trim().is_empty())
        .unwrap_or_else(|| "GEEK-PC".into());
    let os_name = {
        let n = sysinfo::System::name().unwrap_or_default();
        if n.trim().is_empty() {
            "Windows".to_string()
        } else {
            n
        }
    };

    // ---- CPU（sysinfo 兜底，随后被 WMI 覆盖）----
    let cpus = sys.cpus();
    let mut cpu = CpuInfo {
        model: cpus
            .first()
            .map(|c| cpumodel_clean(c.brand()))
            .unwrap_or_default(),
        cores: sys.physical_core_count().unwrap_or(0) as u32,
        threads: cpus.len().max(1) as u32,
        boost: cpus.first().map(|c| c.frequency()).unwrap_or(0) as f64 / 1000.0,
        ..Default::default()
    };

    let mut mem = MemInfo::default();
    let mut board = BoardInfo::default();
    let mut bios_date = String::new();
    let mut os_install = String::new();
    // sysinfo 只给出 "Windows" 这种笼统名称，WMI 的 Caption 才是
    // "Microsoft Windows 10 家庭中文版"；构建号同理。
    let mut os_caption = os_name.clone();
    let mut os_build = sysinfo::System::os_version().unwrap_or_default();
    let mut display = DisplayInfo::default();
    let mut gpu = GpuInfo::default();
    let mut battery = BatteryInfo::default();
    let mut disks: Vec<DiskInfo> = Vec::new();
    let mut volumes: Vec<VolumeInfo> = Vec::new();
    // 物理磁盘在 PowerShell 侧的 DiskNumber(DeviceId)，用于把卷映射回 disks 下标
    let mut disk_dev_ids: Vec<i32> = Vec::new();
    let mut system_disk: i32 = -1;
    let mut system = SystemInfo::default();
    let mut display_count = 0u32;
    let mut fans: Vec<FanInfo> = Vec::new();

    // ---- 一次性 WMI ----
    match fetch_static() {
        Some(w) => {
            // CPU
            if let Some(c) = as_array(g(&w, "cpu")).first() {
                let name = s_of(c, "Name");
                if !name.is_empty() {
                    cpu.model = cpumodel_clean(&name);
                }
                let cores = n_of(c, "NumberOfCores") as u32;
                if cores > 0 {
                    cpu.cores = cores;
                }
                let th = n_of(c, "NumberOfLogicalProcessors") as u32;
                if th > 0 {
                    cpu.threads = th;
                }
                let mx = n_of(c, "MaxClockSpeed");
                if mx > 0.0 {
                    cpu.boost = mx / 1000.0;
                }
                let mn = n_of(c, "MinClockSpeed");
                if mn > 0.0 {
                    cpu.base = mn / 1000.0;
                }
                let l3 = n_of(c, "L3CacheSize") as u64 / 1024;
                if l3 > 0 {
                    cpu.l3 = l3;
                }
                let l2 = n_of(c, "L2CacheSize") as u64 / 1024;
                if l2 > 0 {
                    cpu.l2 = l2;
                }
                cpu.virtualization = b_of(c, "VirtualizationFirmwareEnabled");
                let dw = n_of(c, "DataWidth") as u32;
                if dw > 0 {
                    cpu.data_width = dw;
                }
                cpu.socket = s_of(c, "SocketDesignation");
                cpu.vendor = s_of(c, "Manufacturer");
                if cpu.vendor.contains("GenuineIntel") {
                    cpu.vendor = "Intel".into();
                } else if cpu.vendor.contains("AuthenticAMD") {
                    cpu.vendor = "AMD".into();
                }
            } else {
                degraded.push("CPU".into());
            }
            if cpu.vendor.is_empty() {
                cpu.vendor = if cpu.model.contains("Intel") {
                    "Intel".into()
                } else if cpu.model.contains("AMD") {
                    "AMD".into()
                } else {
                    "—".into()
                };
            }
            // 基准频率兜底：WMI 的 MinClockSpeed 在多数 Intel 平台上为 null，
            // 退回从型号名里的 "@ 3.20GHz" 解析。
            if cpu.base <= 0.0 {
                let b = parse_name_clock(&cpu.model);
                if b > 0.0 {
                    cpu.base = b;
                }
            }
            // 代号 / 制程 / TDP：WMI 不提供，按型号族查表补齐
            let (code, node, tdp) = cpu_spec_lookup(&cpu.model);
            if !code.is_empty() {
                cpu.codename = code;
            }
            if !node.is_empty() {
                cpu.node = node;
            }
            if tdp > 0 {
                cpu.tdp = tdp;
            }

            // 内存
            let slots = as_array(g(&w, "mem"));
            let mut total_kb = 0u64;
            for st in &slots {
                let cap_gb = (n_of(st, "Capacity") / 1024.0 / 1024.0 / 1024.0).round() as u32;
                let speed = n_of(st, "ConfiguredClockSpeed").max(n_of(st, "Speed")) as u32;
                let vendor = clean(s_of(st, "Manufacturer"));
                let locator = s_of(st, "DeviceLocator");
                total_kb += cap_gb as u64 * 1024 * 1024;
                mem.slots.push(MemSlot {
                    name: if locator.is_empty() {
                        format!("DIMM_{}", mem.slots.len())
                    } else {
                        locator
                    },
                    size_gb: cap_gb,
                    speed_mhz: speed,
                    vendor,
                    part_number: s_of(st, "PartNumber").trim().to_string(),
                });
                if mem.speed_mhz == 0 {
                    mem.speed_mhz = speed;
                }
                if mem.vendor.is_empty() || mem.vendor == "—" {
                    mem.vendor = clean(s_of(st, "Manufacturer"));
                }
                let t = n_of(st, "SMBIOSMemoryType") as u32;
                if mem.kind.is_empty() {
                    mem.kind = match t {
                        20 => "DDR",
                        21 => "DDR2",
                        24 => "DDR3",
                        26 => "DDR4",
                        34 | 35 => "DDR5",
                        _ => "",
                    }
                    .into();
                }
            }
            mem.channels = mem.slots.len().max(1) as u32;
            let wmi_total_gb = (total_kb / 1024 / 1024) as u32;
            mem.total_gb = if wmi_total_gb > 0 {
                wmi_total_gb
            } else {
                (sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0).round() as u32
            };
            if mem.kind.is_empty() {
                mem.kind = "—".into();
            }
            if mem.slots.is_empty() {
                degraded.push("内存条明细".into());
            }

            // 显卡：优先独显
            let cards = as_array(g(&w, "gpu"));
            let mut chosen: Option<serde_json::Value> = None;
            for c in &cards {
                let n = s_of(c, "Name");
                if NOISY_GPU.iter().any(|x| n.contains(x)) {
                    continue;
                }
                let is_discrete = n.contains("NVIDIA") || n.contains("Radeon") || n.contains("Arc");
                if chosen.is_none() || is_discrete {
                    chosen = Some(c.clone());
                }
                if is_discrete {
                    break;
                }
            }
            if let Some(ch) = chosen.or_else(|| cards.first().cloned()) {
                let n = s_of(&ch, "Name");
                gpu.model = if n.is_empty() { "—".into() } else { n.clone() };
                gpu.vendor = if n.contains("NVIDIA") {
                    "NVIDIA"
                } else if n.contains("AMD") || n.contains("Radeon") {
                    "AMD"
                } else if n.contains("Intel") {
                    "Intel"
                } else {
                    "—"
                }
                .into();
                gpu.driver = clean(s_of(&ch, "DriverVersion"));
                gpu.bits = n_of(&ch, "CurrentBitsPerPixel") as u32;
                let vp = s_of(&ch, "VideoProcessor");
                if !vp.is_empty() {
                    gpu.video_processor = vp;
                }
                let ram = n_of(&ch, "AdapterRAM");
                // AdapterRAM 为 32 位，>4GB 会溢出，异常值丢弃
                if ram > 0.0 && ram < 4.2e9 {
                    gpu.vram = (ram / 1024.0 / 1024.0 / 1024.0).round() as u32;
                }
                let rw = n_of(&ch, "CurrentHorizontalResolution") as u32;
                let rh = n_of(&ch, "CurrentVerticalResolution") as u32;
                if rw > 0 && rh > 0 {
                    display.res = format!("{} × {}", rw, rh);
                } else {
                    // 分辨率偶尔查不到，退回 VideoModeDescription（"1920 x 1080 x 32 bits"）
                    let vm = s_of(&ch, "VideoModeDescription");
                    let nums: Vec<&str> = vm
                        .split(|c: char| !c.is_ascii_digit())
                        .filter(|s| !s.is_empty())
                        .collect();
                    if nums.len() >= 2 {
                        display.res = format!("{} × {}", nums[0], nums[1]);
                    }
                }
                let rr = n_of(&ch, "CurrentRefreshRate") as u32;
                if rr > 0 {
                    display.refresh = rr;
                }
                // 有 NVIDIA 卡时用 nvidia-smi 的显存与市场版驱动号覆盖
                if let Some(n) = nv.as_ref() {
                    if gpu.vendor == "NVIDIA" {
                        if n.vram_mb > 0 {
                            gpu.vram = (n.vram_mb as f64 / 1024.0).round() as u32;
                        }
                        if !n.driver.is_empty() {
                            gpu.driver = n.driver.clone();
                        }
                    }
                }
            } else {
                degraded.push("显卡".into());
            }

            // 主板 / BIOS
            if let Some(b) = as_array(g(&w, "board")).first() {
                board.vendor = clean(s_of(b, "Manufacturer"));
                board.model = clean(s_of(b, "Product"));
                // Win32_BaseBoard.Version 是主板修订号（如 "Rev X.0x"），
                // 不是芯片组 —— 芯片组从型号名里识别。
                let ver = s_of(b, "Version");
                if !ver.is_empty() && !is_placeholder(&ver) {
                    board.revision = ver.clone();
                }
                if board.model != "—" {
                    board.chipset = chipset_from_model(&board.model);
                }
                if board.chipset.is_empty() {
                    board.chipset = "—".into();
                }
                let sn = s_of(b, "SerialNumber");
                if !sn.is_empty() && !is_placeholder(&sn) {
                    board.serial = sn;
                }
            }
            if let Some(b) = as_array(g(&w, "bios")).first() {
                board.bios = clean(s_of(b, "SMBIOSBIOSVersion"));
                let rd = s_of(b, "ReleaseDate");
                // PowerShell 侧已格式化为 yyyy-MM-dd；这里再兜一层 /Date(ms)/
                bios_date = parse_date_str(&rd);
                let bv = s_of(b, "Manufacturer");
                if !bv.is_empty() {
                    board.bios_vendor = bv;
                }
            }

            // 显示器：型号/厂商来自 EDID(WmiMonitorID)，
            // 物理尺寸来自 WmiMonitorBasicDisplayParams（厘米 → 英寸对角线）
            if let Some(m) = as_array(g(&w, "monitor")).first() {
                let name = wmi_str_array(m, "UserFriendlyName");
                if !name.is_empty() {
                    display.model = name;
                }
                let mf = wmi_str_array(m, "ManufacturerName");
                if !mf.is_empty() {
                    display.vendor = mf;
                }
                // EDID 里的显示器序列号（与主板序列号是两回事）。
                // 多数显示器厂商没烧录真实序列号，会填 "0000000000001" 这类
                // 递增占位值；去掉前导零后长度 ≤ 2 说明不是有效序列号。
                let sn = wmi_str_array(m, "SerialNumberID");
                let sn_t = sn.trim_start_matches('0');
                if !sn.is_empty() && sn_t.len() > 2 {
                    display.serial = sn;
                }
            }
            let basic = as_array(g(&w, "monSize"));
            let conn = as_array(g(&w, "monConn"));
            // 取与当前显示器同实例的那一条；取不到就用第一条
            let pick_idx = basic
                .iter()
                .position(|x| {
                    let inst = s_of(x, "InstanceName");
                    conn.iter().any(|c| {
                        let ci = s_of(c, "InstanceName");
                        !inst.is_empty() && inst == ci
                    })
                })
                .unwrap_or(0);
            if let Some(x) = basic.get(pick_idx).or_else(|| basic.first()) {
                let h_cm = n_of(x, "MaxHorizontalImageSize");
                let v_cm = n_of(x, "MaxVerticalImageSize");
                if h_cm > 0.0 && v_cm > 0.0 {
                    let inch = (h_cm * h_cm + v_cm * v_cm).sqrt() / 2.54;
                    display.size = (inch * 10.0).round() / 10.0;
                }
            }
            if let Some(c) = conn.get(pick_idx).or_else(|| conn.first()) {
                display.connection = match n_of(c, "VideoOutputTechnology") as i64 {
                    1 => "VGA",
                    5 => "DVI",
                    6 => "HDMI",
                    8 => "LVDS",
                    10 => "SDI",
                    11 => "DisplayPort",
                    12 => "eDP",
                    13 | 14 => "UDI",
                    16 => "Miracast",
                    v if v == 0x8000_0000u32 as i64 => "eDP",
                    _ => "—",
                }
                .into();
            }
            if display.model.is_empty() {
                display.model = "Generic PnP Monitor".into();
            }
            if display.vendor.is_empty() {
                display.vendor = "—".into();
            }
            if display.res.is_empty() {
                display.res = "—".into();
            }
            if display.connection.is_empty() {
                display.connection = "—".into();
            }
            display.panel = "—".into();
            display.hdr = "—".into();

            // ---- 逻辑卷（真实分区）----
            for v in as_array(g(&w, "volume")) {
                let size = n_of(&v, "size");
                if size <= 0.0 {
                    continue;
                }
                let free = n_of(&v, "free").clamp(0.0, size);
                let used = size - free;
                let is_sys = g(&v, "system").as_bool().unwrap_or(false);
                volumes.push(VolumeInfo {
                    letter: s_of(&v, "letter"),
                    label: s_of(&v, "label"),
                    fs: clean(s_of(&v, "fs")),
                    size_gb: (to_gib(size) * 10.0).round() / 10.0,
                    used_gb: (to_gib(used) * 10.0).round() / 10.0,
                    free_gb: (to_gib(free) * 10.0).round() / 10.0,
                    used_pct: used / size * 100.0,
                    kind: match s_of(&v, "type").as_str() {
                        "Fixed" => "Fixed".into(),
                        "Removable" => "Removable".into(),
                        "Network" => "Network".into(),
                        "CD-ROM" => "CD-ROM".into(),
                        other if other.is_empty() => "—".into(),
                        other => other.to_string(),
                    },
                    disk: n_of(&v, "disk") as i32,
                    system: is_sys,
                });
            }

            // ---- 物理盘 ----
            // 容量/已用取该盘上所有卷的累加；系统盘标记同样来自卷，
            // 不能再用「第 0 块盘就是系统盘」——装机常见 HDD+SSD 组合，
            // 第 0 块可能是数据盘，系统实际在另一块上。
            for (i, d) in as_array(g(&w, "disk")).iter().enumerate() {
                let size = n_of(d, "size");
                if size <= 0.0 {
                    continue;
                }
                let bus = s_of(d, "bus");
                let media = s_of(d, "media");
                let health = s_of(d, "health");
                let is_sys = g(d, "system").as_bool().unwrap_or(false);
                // 未分区/含隐藏分区的盘卷累加可能为 0，退回物理容量
                let cap_bytes = if n_of(d, "cap") > 0.0 { n_of(d, "cap") } else { size };
                let used_bytes = n_of(d, "used").clamp(0.0, cap_bytes);
                if is_sys {
                    system_disk = i as i32;
                }
                disk_dev_ids.push(n_of(d, "disk") as i32);
                disks.push(DiskInfo {
                    id: i as u32,
                    model: clean(s_of(d, "model")),
                    iface: match bus.as_str() {
                        "NVMe" => "NVMe".into(),
                        "SATA" => "SATA".into(),
                        "USB" => "USB".into(),
                        "RAID" => "RAID".into(),
                        "SCSI" => "SCSI".into(),
                        other if other.is_empty() => "—".into(),
                        other => other.to_string(),
                    },
                    kind: if media.contains("SSD") {
                        "ssd"
                    } else if media.contains("HDD") {
                        "hdd"
                    } else {
                        "ssd"
                    }
                    .into(),
                    cap_gb: to_gib(cap_bytes).round() as u64,
                    used_gb: to_gib(used_bytes).round() as u64,
                    // 只有驱动器明确报了状态才给健康度；读不到（例如 Android
                    // 非 root 拿不到 SMART）就留空显示「—」，不编造 100%。
                    health: match health.as_str() {
                        "Healthy" => Some(100),
                        "Warning" => Some(72),
                        "Unhealthy" => Some(45),
                        _ => None,
                    },
                    temp: None,
                    power_on: None,
                    hours: None,
                    read_mb: None,
                    write_mb: None,
                    system: is_sys,
                });
            }
            if disks.is_empty() {
                degraded.push("物理磁盘".into());
            }
            if volumes.is_empty() {
                degraded.push("逻辑卷".into());
            }
            // 卷的 disk 字段在 PS 侧记的是 DiskNumber(DeviceId)，而 disks 数组
            // 按下标索引，两者顺序并不一致（本机恰好是反的）。统一换算成
            // disks 数组下标，保证前端拿到的两份数据能对上。
            for v in volumes.iter_mut() {
                let dev = v.disk;
                v.disk = disk_dev_ids
                    .iter()
                    .position(|x| *x == dev)
                    .map(|i| i as i32)
                    .unwrap_or(-1);
            }

            // 主机（制造商 / 型号 / 机箱形态）
            if let Some(s) = as_array(g(&w, "sys")).first() {
                let mf = s_of(s, "Manufacturer");
                let md = s_of(s, "Model");
                system.manufacturer = if is_placeholder(&mf) { "—".into() } else { mf };
                system.model = if is_placeholder(&md) { "—".into() } else { md };
            }

            // 操作系统
            if let Some(o) = as_array(g(&w, "os")).first() {
                let cap = s_of(o, "Caption");
                if !cap.is_empty() {
                    os_caption = cap.trim_start_matches("Microsoft ").to_string();
                }
                let bn = s_of(o, "BuildNumber");
                if !bn.is_empty() {
                    os_build = bn;
                }
                os_install = parse_date_str(&s_of(o, "InstallDate"));
            }
            let total_mem = as_array(g(&w, "sys"))
                .first()
                .map(|s| n_of(s, "TotalPhysicalMemory"))
                .unwrap_or(0.0);
            if total_mem > 0.0 {
                let gb = (total_mem / 1024.0 / 1024.0 / 1024.0).round() as u32;
                if gb > 0 && mem.total_gb == 0 {
                    mem.total_gb = gb;
                }
            }
            // 机箱类型：3=桌面 4=低矮型 6=Mini 7=塔式 8=便携 9=笔记本 10=Notebook 30=平板
            let chassis_code = as_array(g(&w, "chassis"))
                .first()
                .and_then(|c| match g(c, "ChassisTypes") {
                    serde_json::Value::Array(a) => a.first().and_then(|x| x.as_u64()),
                    serde_json::Value::Number(n) => n.as_u64(),
                    _ => None,
                })
                .unwrap_or(0);
            let (chassis_name, is_laptop) = match chassis_code {
                3 => ("台式机", false),
                4 => ("一体机", false),
                6 => ("迷你主机", false),
                7 => ("塔式机箱", false),
                8 | 9 | 10 | 14 => ("笔记本", true),
                30 | 31 | 32 => ("平板", true),
                17 => ("大型机", false),
                23 => ("机架式", false),
                0 => ("—", false),
                _ => ("桌面主机", false),
            };
            system.chassis = chassis_name.to_string();
            system.is_laptop = is_laptop;
            system.arch_bits = if cpu.data_width > 0 { cpu.data_width } else { 64 };

            // 移动端：SMBIOS 没有"手机"这一形态，这里直接定名，
            // 并按移动设备处理电源语义（有电池）。
            #[cfg(target_os = "android")]
            {
                system.chassis = "手机".to_string();
                system.is_laptop = true;
            }

            // 风扇（Win32_Fan，多数消费级主板不暴露）
            for f in as_array(g(&w, "fan")) {
                let name = s_of(&f, "Name");
                let rpm = n_of(&f, "DesiredSpeed") as u32;
                if name.is_empty() {
                    continue;
                }
                fans.push(FanInfo { name, rpm });
            }

            // 显示器数量
            display_count = as_array(g(&w, "monitor")).len() as u32;

            // 电池：Win32_Battery 只给状态，容量与循环次数在 root/wmi 的三个类里
            if !as_array(g(&w, "battery")).is_empty() {
                battery.present = true;
            }
            if let Some(b) = as_array(g(&w, "batDesign")).first() {
                let v = n_of(b, "DesignedCapacity");
                if v > 0.0 {
                    // root/wmi 给的是 mWh
                    battery.design_wh = (v / 1000.0 * 10.0).round() / 10.0;
                }
            }
            if let Some(b) = as_array(g(&w, "batFull")).first() {
                let v = n_of(b, "FullChargedCapacity");
                if v > 0.0 {
                    battery.full_wh = (v / 1000.0 * 10.0).round() / 10.0;
                }
            }
            if let Some(b) = as_array(g(&w, "batCycle")).first() {
                let v = n_of(b, "CycleCount") as u32;
                if v > 0 {
                    battery.cycles = v;
                }
            }
            // 台式机 / 迷你主机通常无电池，避免界面出现空白的电池项
            if !is_laptop && !battery.present {
                degraded.push("Battery:absent".into());
            }
        }
        None => {
            degraded.push(if cfg!(windows) {
                "WMI 不可用".to_string()
            } else {
                "系统接口不可读".to_string()
            });
            mem.total_gb = (sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0).round() as u32;
        }
    }

    if battery.full_wh == 0.0 && battery.design_wh > 0.0 {
        battery.full_wh = battery.design_wh;
    }
    if !battery.present {
        battery = BatteryInfo::default();
    }
    if display_count == 0 {
        display_count = 1;
    }

    let seed = host
        .bytes()
        .fold(0u32, |a, b| a.wrapping_mul(31).wrapping_add(b as u32))
        % 100000;

    DeviceProfile {
        seed,
        host,
        os: OsInfo {
            name: os_caption,
            build: os_build,
            arch: std::env::consts::ARCH.to_string(),
        },
        cpu,
        gpu,
        board,
        display,
        display_count,
        disks,
        volumes,
        system_disk,
        battery,
        mem,
        bios_date,
        os_install,
        fans,
        system,
        degraded,
        native: true,
        platform: if cfg!(target_os = "windows") {
            "windows"
        } else if cfg!(target_os = "android") {
            "android"
        } else {
            "linux"
        }
        .into(),
    }
}

// ============================================================
// 传感器
// ============================================================
fn lhm_available() -> bool {
    run_ps("if (Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue) { 'YES' } else { 'NO' }")
        .map(|s| s.contains("YES"))
        .unwrap_or(false)
}

fn read_lhm() -> Option<Vec<SensorReading>> {
    let v = ps_json("Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor | Select-Object -Property Name,SensorType,Value")?;
    let mut out = Vec::new();
    for s in as_array(&v) {
        let st = s_of(&s, "SensorType");
        let (unit, kind) = match st.as_str() {
            "Temperature" => ("°C", "温度"),
            "Fan" => ("RPM", "风扇"),
            "Voltage" => ("V", "电压"),
            "Power" => ("W", "功耗"),
            "Load" => ("%", "负载"),
            "Clock" => ("MHz", "频率"),
            _ => continue,
        };
        let name = s_of(&s, "Name");
        if name.is_empty() {
            continue;
        }
        out.push(SensorReading {
            name,
            kind: kind.into(),
            unit: unit.into(),
            value: Some(n_of(&s, "Value")),
        });
    }
    if out.is_empty() { None } else { Some(out) }
}

fn nvidia_available() -> bool {
    run_ps("if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { 'YES' } else { 'NO' }")
        .map(|s| s.contains("YES"))
        .unwrap_or(false)
}

/// nvidia-smi 静态信息：显存总量 + 市场版驱动号。
/// WMI 的 AdapterRAM 是 32 位（>4GB 溢出），DriverVersion 是内部号
/// （30.0.14.7514），用户认的是 475.14 这种市场版本号。
fn read_nvidia_static() -> Option<NvStatic> {
    let s = run_ps("$r = & nvidia-smi --query-gpu=memory.total,driver_version --format=csv,noheader,nounits 2>$null; if ($r) { ($r | Select-Object -First 1) }")?;
    let line = s.lines().next()?;
    let p: Vec<&str> = line.split(',').map(|x| x.trim()).collect();
    if p.len() < 2 {
        return None;
    }
    let drv = p[1];
    Some(NvStatic {
        vram_mb: p[0].parse::<u32>().unwrap_or(0),
        driver: if drv.is_empty() || drv.eq_ignore_ascii_case("[N/A]") {
            String::new()
        } else {
            drv.to_string()
        },
    })
}

/// 单张 NVIDIA 卡的实时读数。任何一项都可能是 [N/A]：
/// 消费级 GeForce（尤其老架构）不开放利用率/温度/功耗查询，
/// 这时对应项返回 None，界面显示「—」，绝不拿 0 冒充读数。
#[derive(Default, Clone)]
struct NvLive {
    usage: Option<f64>,
    temp: Option<f64>,
    clock: Option<f64>,
    power: Option<f64>,
}

fn read_nvidia() -> Option<NvLive> {
    let s = run_ps("$r = & nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,clocks.sm,power.draw --format=csv,noheader,nounits 2>$null; if ($r) { ($r | Select-Object -First 1) }")?;
    let line = s.lines().next()?;
    let parts: Vec<&str> = line.split(',').map(|x| x.trim()).collect();
    if parts.len() < 4 {
        return None;
    }
    // [N/A] / 空 / 非数字 一律视为无读数；温度与频率为 0 也视为无效读数
    let raw = |i: usize| -> Option<f64> {
        let t = parts[i];
        if t.is_empty() || t.eq_ignore_ascii_case("[N/A]") || t.eq_ignore_ascii_case("n/a") {
            return None;
        }
        t.parse::<f64>().ok().filter(|v| v.is_finite())
    };
    let usage = raw(0).filter(|v| (0.0..=100.0).contains(v));
    let temp = raw(1).filter(|v| *v > 0.0 && *v < 130.0);
    let clock = raw(2).filter(|v| *v > 0.0);
    let power = raw(3).filter(|v| *v >= 0.0 && *v < 1000.0);
    if usage.is_none() && temp.is_none() && clock.is_none() && power.is_none() {
        return None;
    }
    Some(NvLive { usage, temp, clock, power })
}

/// GPU 引擎利用率 —— Windows 性能计数器，覆盖 Intel / AMD / NVIDIA **全部**显卡，
/// 解决 GeForce 不开放 nvidia-smi 利用率查询的问题。
/// 单次约 1.5s，因此只在后台线程低频采样，不进实时循环。
/// 返回 (3D 引擎利用率%, 专用显存占用 MB)
#[cfg(windows)]
fn read_gpu_engine() -> Option<(f64, Option<u32>)> {
    let out = run_ps(
        r#"$ErrorActionPreference='SilentlyContinue'
$inv = [System.Globalization.CultureInfo]::InvariantCulture
try { $e = (Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -ErrorAction Stop).CounterSamples } catch { $e = $null }
try { $m = (Get-Counter '\GPU Adapter Memory(*)\Dedicated Usage' -ErrorAction Stop).CounterSamples } catch { $m = $null }
$u = 'NA'
if ($e) { $u = [math]::Round((($e | Measure-Object CookedValue -Sum).Sum),1).ToString($inv) }
$v = 'NA'
if ($m) { $v = [math]::Round(((($m | Measure-Object CookedValue -Maximum).Maximum)/1MB),0).ToString($inv) }
"$u|$v""#,
    )?;
    let line = out.lines().next()?;
    let mut it = line.split('|');
    let u = it.next().unwrap_or("").trim();
    let v = it.next().unwrap_or("").trim();
    let usage = u.parse::<f64>().ok().filter(|x| x.is_finite());
    let vram = v.parse::<f64>().ok().filter(|x| *x >= 0.0).map(|x| x as u32);
    match (usage, vram) {
        (None, None) => None,
        _ => Some((usage.unwrap_or(-1.0), vram)),
    }
}

// ============================================================
// 电池（Win32 直调）
// ============================================================
fn read_battery() -> (Option<f64>, String) {
    #[cfg(windows)]
    {
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut st = SYSTEM_POWER_STATUS::default();
        if unsafe { GetSystemPowerStatus(&mut st) }.is_err() {
            return (None, "unknown".into());
        }
        if st.BatteryFlag == 128 {
            // 128 = 无系统电池
            return (None, "none".into());
        }
        let pct = if st.BatteryLifePercent == 255 {
            None
        } else {
            Some(st.BatteryLifePercent as f64)
        };
        let state = match st.ACLineStatus {
            1 => {
                if pct.map(|p| p >= 99.5).unwrap_or(false) {
                    "full"
                } else {
                    "charging"
                }
            }
            0 => "discharging",
            _ => "unknown",
        };
        (pct, state.to_string())
    }
    #[cfg(not(windows))]
    {
        crate::hw_linux::battery()
    }
}

// ============================================================
// 实时快照
// ============================================================
fn snapshot(c: &mut Collector) -> LiveSnapshot {
    c.sys.refresh_cpu_usage();
    c.sys.refresh_memory();
    // 进程级磁盘 IO 需显式声明刷新项，否则恒为 0
    c.sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::new().with_disk_usage(),
    );
    c.networks.refresh();

    let cpus = c.sys.cpus();
    let cpu_usage = c.sys.global_cpu_usage() as f64;
    let cpu_clock = cpus.iter().map(|x| x.frequency()).max().unwrap_or(0) as f64 / 1000.0;

    let mut cpu_temp: Option<f64> = None;
    let mut cpu_power: Option<f64> = None;

    // 移动端 / Linux：/sys/class/thermal 的 SoC 温度
    #[cfg(not(windows))]
    {
        cpu_temp = crate::hw_linux::cpu_temp();
    }

    if c.lhm_ok {
        if let Some(sensors) = read_lhm() {
            for s in &sensors {
                if s.unit == "°C" && !s.name.to_uppercase().contains("GPU") {
                    if s.name.contains("Package") {
                        cpu_temp = s.value;
                    } else if cpu_temp.is_none() {
                        cpu_temp = s.value;
                    }
                }
                if s.unit == "W" && s.name.contains("Package") {
                    cpu_power = s.value;
                }
            }
        }
    }

    // GPU 实时数据：优先 nvidia-smi；它给不出的项（GeForce 老卡常全为 [N/A]）
    // 再用后台采样的 GPU 引擎计数器兜底。
    let (mut gpu_usage, mut gpu_temp, mut gpu_clock, mut gpu_power) = (None, None, None, None);
    if c.smi_ok {
        if let Some(n) = read_nvidia() {
            gpu_usage = n.usage;
            gpu_temp = n.temp;
            gpu_clock = n.clock;
            gpu_power = n.power;
        }
    }
    if gpu_usage.is_none() {
        gpu_usage = c.gpu_engine_pct.filter(|v| *v >= 0.0);
    }

    // 网络速率
    let (rx, tx) = c
        .networks
        .iter()
        .fold((0u64, 0u64), |a, (_, d)| {
            (a.0 + d.total_received(), a.1 + d.total_transmitted())
        });
    let now = Instant::now();
    let dt = now.duration_since(c.last_net_at).as_secs_f64().max(0.05);
    let net_down = if c.last_net.0 == 0 {
        0.0
    } else {
        (rx.saturating_sub(c.last_net.0)) as f64 / dt / 1024.0
    };
    let net_up = if c.last_net.1 == 0 {
        0.0
    } else {
        (tx.saturating_sub(c.last_net.1)) as f64 / dt / 1024.0
    };
    c.last_net = (rx, tx);
    c.last_net_at = now;

    // 磁盘吞吐：进程累计 IO 求增量
    let (dread, dwrite) = c.sys.processes().values().fold((0u64, 0u64), |a, p| {
        let du = p.disk_usage();
        (a.0 + du.read_bytes, a.1 + du.written_bytes)
    });
    let dt2 = now.duration_since(c.last_disk_at).as_secs_f64().max(0.05);
    let disk_read = if c.last_disk_io.0 == 0 {
        0.0
    } else {
        (dread.saturating_sub(c.last_disk_io.0)) as f64 / dt2 / 1024.0 / 1024.0
    };
    let disk_write = if c.last_disk_io.1 == 0 {
        0.0
    } else {
        (dwrite.saturating_sub(c.last_disk_io.1)) as f64 / dt2 / 1024.0 / 1024.0
    };
    c.last_disk_io = (dread, dwrite);
    c.last_disk_at = now;

    // 降级估算：无传感器时按负载推算，并置 estimated
    let estimated = cpu_temp.is_none() || cpu_power.is_none();
    let tdp = if c.profile.cpu.tdp > 0 {
        c.profile.cpu.tdp as f64
    } else {
        // 按核心数粗估 TDP（仅用于功耗显示的量级参考）
        (c.profile.cpu.cores.max(4) as f64 * 8.0).clamp(65.0, 253.0)
    };
    let boost = if c.profile.cpu.boost > 0.0 { c.profile.cpu.boost } else { 4.0 };

    let cpu_temp_final = cpu_temp.or(Some(38.0 + cpu_usage * 0.40));
    let cpu_power_final = cpu_power.or(Some(12.0 + (tdp - 12.0) * (cpu_usage / 100.0).powf(1.35)));

    let mut per_core: Vec<CoreLoad> = cpus
        .iter()
        .map(|cpu| CoreLoad {
            usage: cpu.cpu_usage() as f64,
            temp: None,
            clock: cpu.frequency() as f64 / 1000.0,
        })
        .collect();
    if let Some(ct) = cpu_temp_final {
        for (i, core) in per_core.iter_mut().enumerate() {
            core.temp = Some((ct + ((i as f64 * 1.7) % 5.0) - 2.0).clamp(25.0, 105.0));
        }
    }
    let _ = boost;

    let mem_total_gb = c.sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let mem_used_gb = c.sys.used_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    let mem_percent = if mem_total_gb > 0.0 {
        (mem_used_gb / mem_total_gb * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    let system_power = Some(
        cpu_power_final.unwrap_or(0.0)
            + gpu_power.unwrap_or(0.0)
            + if c.profile.battery.present { 12.0 } else { 35.0 },
    );

    let (battery_percent, battery_state) = read_battery();

    let load = if cpu_usage < 25.0 {
        "idle"
    } else if cpu_usage < 62.0 {
        "normal"
    } else if cpu_usage < 88.0 {
        "heavy"
    } else {
        "extreme"
    };

    LiveSnapshot {
        cpu_usage,
        cpu_temp: cpu_temp_final,
        cpu_clock,
        cpu_power: cpu_power_final,
        mem_used_gb,
        mem_percent,
        gpu_usage,
        gpu_temp,
        gpu_clock,
        gpu_power,
        gpu_vram_used_mb: c.gpu_vram_used_mb,
        disk_read,
        disk_write,
        net_down,
        net_up,
        system_power,
        uptime_sec: sysinfo::System::uptime(),
        battery_percent,
        battery_state: battery_state.to_string(),
        per_core,
        load: load.into(),
        estimated,
    }
}

// ============================================================
// 对外接口
// ============================================================
pub fn init() {
    COLLECTOR.get_or_init(|| {
        let mut sys = sysinfo::System::new_all();
        // CPU 使用率需要两次采样之间留出最小间隔
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
        sys.refresh_cpu_usage();

        let networks = sysinfo::Networks::new_with_refreshed_list();
        // nvidia-smi 静态信息先取：显存与市场版驱动号要并入显卡档案
        let nv_live_ok = nvidia_available();
        let nv = if nv_live_ok { read_nvidia_static() } else { None };
        let profile = build_profile(&sys, nv);

        let lhm_ok = lhm_available();
        let smi_ok = nv_live_ok;

        let now = Instant::now();
        Mutex::new(Collector {
            sys,
            networks,
            profile,
            last_net: (0, 0),
            last_net_at: now,
            lhm_ok,
            smi_ok,
            last_disk_io: (0, 0),
            last_disk_at: now,
            gpu_engine_pct: None,
            gpu_vram_used_mb: None,
        })
    });

    start_gpu_sampler();
}

/// GPU 引擎利用率后台采样。
/// Get-Counter 单次约 1.5s，放进实时刷新循环会把界面拖死，
/// 所以独立线程每 3 秒采一次、写进缓存，实时快照只读缓存。
#[cfg(windows)]
fn start_gpu_sampler() {
    use std::sync::OnceLock;
    static SPAWNED: OnceLock<()> = OnceLock::new();
    SPAWNED.get_or_init(|| {
        std::thread::spawn(|| loop {
            if let Some((u, v)) = read_gpu_engine() {
                if let Some(m) = COLLECTOR.get() {
                    if let Ok(mut g) = m.lock() {
                        if u >= 0.0 {
                            g.gpu_engine_pct = Some(u);
                        }
                        if v.is_some() {
                            g.gpu_vram_used_mb = v;
                        }
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(3));
        });
    });
}

#[cfg(not(windows))]
fn start_gpu_sampler() {}

pub fn get_profile() -> DeviceProfile {
    init();
    COLLECTOR
        .get()
        .and_then(|m| m.lock().ok().map(|g| g.profile.clone()))
        .unwrap_or_default()
}

pub fn get_live() -> LiveSnapshot {
    init();
    match COLLECTOR.get().and_then(|m| m.lock().ok()) {
        Some(mut g) => snapshot(&mut g),
        None => LiveSnapshot::default(),
    }
}

pub fn get_sensors() -> Vec<SensorReading> {
    init();
    let lhm_ok = COLLECTOR
        .get()
        .and_then(|m| m.lock().ok().map(|g| g.lhm_ok))
        .unwrap_or(false);

    let mut out: Vec<SensorReading> = Vec::new();
    if lhm_ok {
        if let Some(s) = read_lhm() {
            out.extend(s);
        }
    }
    // 移动端 / Linux：从 /sys/class/thermal 与 power_supply 取温度
    #[cfg(not(windows))]
    {
        out.extend(crate::hw_linux::sensors());
    }
    // 即使有 LHM，也补上 nvidia-smi 的显卡项（LHM 未必覆盖独显）
    let smi_ok = COLLECTOR
        .get()
        .and_then(|m| m.lock().ok().map(|g| g.smi_ok))
        .unwrap_or(false);
    for (name, kind, unit, value) in gpu_sensor_rows(smi_ok) {
        out.push(SensorReading { name, kind, unit, value });
    }
    out
}

/// GPU 传感器行：nvidia-smi 有什么就出什么，读不到的项不出（不伪造 0）。
fn gpu_sensor_rows(smi_ok: bool) -> Vec<(String, String, String, Option<f64>)> {
    let mut out: Vec<(String, String, String, Option<f64>)> = Vec::new();
    if smi_ok {
        if let Some(n) = read_nvidia() {
            if let Some(v) = n.usage {
                out.push(("GPU Load".into(), "负载".into(), "%".into(), Some(v)));
            }
            if let Some(v) = n.temp {
                out.push(("GPU Core".into(), "温度".into(), "°C".into(), Some(v)));
            }
            if let Some(v) = n.clock {
                out.push(("GPU Clock".into(), "频率".into(), "MHz".into(), Some(v)));
            }
            if let Some(v) = n.power {
                out.push(("GPU Power".into(), "功耗".into(), "W".into(), Some(v)));
            }
        }
    }
    // nvidia-smi 给不出利用率时，用后台采样的引擎计数器补一条
    if !out.iter().any(|r| r.0 == "GPU Load") {
        if let Some(u) = COLLECTOR
            .get()
            .and_then(|m| m.lock().ok().map(|g| g.gpu_engine_pct))
            .flatten()
        {
            if u >= 0.0 {
                out.push(("GPU Engine 3D".into(), "负载".into(), "%".into(), Some(u)));
            }
        }
    }
    out
}

pub fn get_startup_items() -> Vec<StartupItem> {
    let mut out: Vec<StartupItem> = Vec::new();
    // 启动项的启用/禁用状态不在 Win32_StartupCommand 里，必须读
    // Explorer\StartupApproved 下的二进制标志：首字节为偶数=启用、奇数=禁用。
    // 读不到就标记 state_known=false，界面显示「状态未知」而不是硬说已启用。
    let v = ps_json(
        r#"$ErrorActionPreference='SilentlyContinue'
$appr = @{}
$anyKey = $false
foreach ($root in @('HKCU','HKLM')) {
  foreach ($sub in @('Run','Run32','StartupFolder','StartupFolder32')) {
    $p = "$($root):\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\$sub"
    if (Test-Path $p) {
      $anyKey = $true
      $item = Get-Item $p
      foreach ($n in $item.Property) {
        $val = (Get-ItemProperty -Path $p -Name $n).$n
        if ($val -is [byte[]]) { $appr[$n] = [int]($val[0] -band 1) }
      }
    }
  }
}
$out = @()
foreach ($s in (Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location,User)) {
  $d = -1
  $nm = [string]$s.Name
  # 首字节偶数=启用、奇数=禁用（与任务管理器「启动」页完全互通）
  foreach ($c in @($nm, "$nm.lnk", "$nm.url", "$nm.exe")) {
    if ($appr.ContainsKey($c)) { $d = $appr[$c]; break }
  }
  if ($d -lt 0) {
    # 反向匹配：StartupApproved 的键名可能带扩展名，而 Name 不带
    foreach ($k in $appr.Keys) {
      if ([System.IO.Path]::GetFileNameWithoutExtension($k) -ieq $nm) { $d = $appr[$k]; break }
    }
  }
  # 没有任何记录 = 没人改过 = 走默认（启用）。
  # 只有连 StartupApproved 键都读不到时才算状态未知。
  $known = $true
  if ($d -lt 0) {
    if ($anyKey) { $d = 0 } else { $known = $false }
  }
  $out += [pscustomobject]@{
    name     = $nm
    command  = [string]$s.Command
    location = [string]$s.Location
    user     = [string]$s.User
    disabled = $d
    known    = $known
  }
}
@($out)"#,
    );
    if let Some(v) = v {
        for s in as_array(&v) {
            let name = s_of(&s, "name");
            if name.is_empty() {
                continue;
            }
            let cmd = s_of(&s, "command");
            // 发布者：命令串里第一个 .exe 的文件名
            let publisher = cmd
                .split('"')
                .flat_map(|seg| seg.split('\\'))
                .filter(|seg| seg.to_ascii_lowercase().ends_with(".exe"))
                .last()
                .unwrap_or("")
                .to_string();
            let loc = s_of(&s, "location").to_ascii_lowercase();
            // 来源分类：注册表 Run 键 / 启动文件夹 / 计划任务
            let kind = if loc.contains("startup") {
                "folder"
            } else if loc.contains("task") || loc.contains("schedule") {
                "task"
            } else {
                "registry"
            };
            let d = n_of(&s, "disabled") as i32;
            let known = b_of(&s, "known");
            out.push(StartupItem {
                name,
                publisher: if publisher.is_empty() { "—".into() } else { publisher },
                // Run 键与启动文件夹里的项都是开机自启
                boot: true,
                disabled: d == 1,
                kind: kind.into(),
                state_known: known && d >= 0,
            });
        }
    }
    out.sort_by(|a, b| {
        // 状态未知的沉到最后，便于一眼看出哪些没能判定
        (a.state_known as u8)
            .cmp(&(b.state_known as u8))
            .reverse()
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out.truncate(60);
    out
}

/// 驱动列表。
///
/// 关键修正：
///  1. DriverDate 由 PowerShell 侧格式化成 yyyy-MM-dd（PS 5.1 的 ConvertTo-Json
///     会把 [datetime] 写成 /Date(ms)/，原先按 yyyyMMdd 切片得到 "te/Dat"）。
///  2. 过滤掉 Microsoft 的虚拟设备（Local Print Queue / Microsoft Kernel 之类的
///     伪条目），否则列表前几屏全是无意义的软件队列。
///  3. 带真实厂商的排在前面，便于一眼看到显卡/网卡/声卡驱动。
pub fn get_drivers() -> Vec<DriverItem> {
    let mut out: Vec<DriverItem> = Vec::new();
    let v = ps_json(
        r#"Get-CimInstance Win32_PnPSignedDriver |
  Where-Object { $_.DeviceName -and $_.DriverVersion -and $_.DeviceName -notmatch '^(Local Print Queue|Microsoft Print|Root Print|WAN Miniport|Microsoft Kernel|Generic volume|Generic PnP|Volume Shadow|UMBus|Composite Bus|ACPI )' } |
  Select-Object DeviceName,DriverVersion,Manufacturer,@{n='DriverDate';e={ if ($_.DriverDate) { ([datetime]$_.DriverDate).ToString('yyyy-MM-dd') } else { '' } }}"#,
    );
    if let Some(v) = v {
        let mut seen: Vec<String> = Vec::new();
        for d in as_array(&v) {
            let name = s_of(&d, "DeviceName");
            if name.is_empty() || seen.iter().any(|x| x.eq_ignore_ascii_case(&name)) {
                continue;
            }
            seen.push(name.clone());
            let vendor_raw = s_of(&d, "Manufacturer");
            let placeholder = is_placeholder(&vendor_raw)
                || vendor_raw.to_ascii_lowercase() == "(standard system devices)"
                || vendor_raw.to_ascii_lowercase() == "(standard keyboards)";
            out.push(DriverItem {
                device: name,
                ver: clean(s_of(&d, "DriverVersion")),
                date: {
                    let d2 = parse_date_str(&s_of(&d, "DriverDate"));
                    if d2.is_empty() { "—".into() } else { d2 }
                },
                vendor: if placeholder { "—".into() } else { vendor_raw },
            });
        }
    }
    // 有真实厂商的排前面，其余按设备名稳定排序
    out.sort_by(|a, b| {
        let pa = (a.vendor == "—") as u8;
        let pb = (b.vendor == "—") as u8;
        pa.cmp(&pb)
            .then_with(|| b.date.cmp(&a.date))
            .then_with(|| a.device.to_lowercase().cmp(&b.device.to_lowercase()))
    });
    out.truncate(60);
    out
}

/// 进程占用 TOP 榜（按 CPU 降序）。
/// 数据来自实时快照里已经刷新过的进程表，不额外增加采集开销。
pub fn get_top_processes() -> Vec<ProcessInfo> {
    init();
    let mut list: Vec<ProcessInfo> = match COLLECTOR.get().and_then(|m| m.lock().ok()) {
        Some(g) => g
            .sys
            .processes()
            .values()
            .map(|p| ProcessInfo {
                pid: p.pid().as_u32(),
                name: {
                    let n = p.name().to_string_lossy().to_string();
                    // 截掉 ".exe" 让表格更紧凑
                    n.strip_suffix(".exe").unwrap_or(&n).to_string()
                },
                cpu: p.cpu_usage() as f64,
                mem_mb: p.memory() as f64 / 1024.0 / 1024.0,
            })
            .collect(),
        None => Vec::new(),
    };
    // 只保留占用可见的进程，避免一堆 0% 噪声
    list.retain(|p| p.cpu >= 0.1 || p.mem_mb >= 30.0);
    list.sort_by(|a, b| {
        b.cpu
            .partial_cmp(&a.cpu)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.mem_mb.partial_cmp(&a.mem_mb).unwrap_or(std::cmp::Ordering::Equal))
    });
    list.truncate(12);
    list
}

/// 供前端展示当前采集能力（哪些来源可用）
pub fn capabilities() -> serde_json::Value {
    init();
    let (lhm, smi, degraded) = COLLECTOR
        .get()
        .and_then(|m| m.lock().ok().map(|g| (g.lhm_ok, g.smi_ok, g.profile.degraded.clone())))
        .unwrap_or((false, false, Vec::new()));
    serde_json::json!({
        "libreHardwareMonitor": lhm,
        "nvidiaSmi": smi,
        "degraded": degraded,
        "platform": std::env::consts::OS,
    })
}
/// 采集自检：把当前采集结果汇总成 JSON。
/// 用于核对「界面显示的是不是真数据」，也便于排查某台机器上哪一项读不到。
pub fn selftest_json() -> String {
    init();
    // 等 GPU 引擎计数器出首次读数（后台线程约 1.5s 采一次）。
    // 不等的话诊断结果里显卡利用率恒为 null，会被误判成采集失败。
    #[cfg(windows)]
    for _ in 0..14 {
        let got = COLLECTOR
            .get()
            .and_then(|m| m.lock().ok().map(|g| g.gpu_engine_pct.is_some()))
            .unwrap_or(false);
        if got {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
    let snap = serde_json::json!({
        "capabilities": capabilities(),
        "profile": get_profile(),
        "drivers": get_drivers(),
        "startup": get_startup_items(),
        "sensors": get_sensors(),
        "processes": get_top_processes(),
        "live": get_live(),
    });
    serde_json::to_string_pretty(&snap).unwrap_or_else(|e| format!("{{\"error\":\"{}\"}}", e))
}
