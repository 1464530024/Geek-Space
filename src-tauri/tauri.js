// Tauri 的 Android Gradle 插件（buildSrc/BuildTask.kt）会以 src-tauri 为
// 工作目录执行 `node tauri android android-studio-script ...`。
// Node 会把 `tauri` 当作相对路径解析，而 CLI 实际位于项目根的
// node_modules/@tauri-apps/cli —— 因此这里做一层转发，
// 使 Gradle 侧的 Rust 构建任务能够正常调用 Tauri CLI。
require('@tauri-apps/cli');
