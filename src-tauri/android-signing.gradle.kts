// ============================================================
// 极客空间 Geek Space — Android release 签名配置片段
// ------------------------------------------------------------
// tauri android init 生成的 app/build.gradle.kts 默认不配置签名，
// release 产物为未签名 APK（无法直接安装）。构建脚本会把本片段
// 注入 android {} 块与 release buildType，产出可直接分发的签名 APK。
//
// 密钥库：gen/android/geek-space.keystore
//   别名 geekspace / 口令 geekspace2026
//   自用分发用；如需上架请替换为你自己的密钥并妥善保管。
// ============================================================
signingConfigs {
    create("release") {
        storeFile = file("../geek-space.keystore")
        storePassword = "geekspace2026"
        keyAlias = "geekspace"
        keyPassword = "geekspace2026"
    }
}
