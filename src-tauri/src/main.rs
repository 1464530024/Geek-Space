// Windows release 构建时隐藏控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // 诊断模式：`geek-space.exe --dump-device [输出路径]`
    // 把本机实际采集到的设备档案 / 驱动 / 启动项 / 传感器 / 实时快照
    // 落盘成 JSON。用于核对界面显示的是否为真实数据，
    // 以及在别人的机器上排查「哪一项读不到」。
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--dump-device") {
        let path = args
            .iter()
            .skip_while(|a| *a != "--dump-device")
            .nth(1)
            .cloned()
            .unwrap_or_else(|| "geek-space-device.json".to_string());
        let body = geek_space_lib::collector::selftest_json();
        match std::fs::write(&path, body) {
            Ok(_) => {
                // 中文路径在控制台可能显示为乱码，这里只回报字节数避免误导
                println!("[Geek Space] 采集结果已写入 {} 字节 -> {}", std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0), path);
            }
            Err(e) => eprintln!("[Geek Space] 写入失败: {}", e),
        }
        return;
    }
    geek_space_lib::run()
}
