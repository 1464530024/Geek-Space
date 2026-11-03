# ============================================================
# 极客空间 Geek Space — Android APK 构建
# ------------------------------------------------------------
# 四个已知坑，脚本已自动处理：
#   1. MinGW 工具链无法处理含中文的路径
#      → 同步到纯 ASCII 目录 D:\build\geek-space 再编译
#   2. tauri android build 会用符号链接把 .so 放进 jniLibs，
#      Windows 非开发者模式下不允许 → 改为直接复制 .so，
#      绕过 tauri CLI，直接调用 Gradle 打包
#   3. tauri android init 生成的工程没有 release 签名配置，
#      产物无法安装 → 自动生成 keystore 并注入签名配置
#   4. robocopy /MIR 会删除目标端「源里没有」的文件，
#      gen/android 是构建产物 → 必须从镜像中排除
#
# 注意：所有外部命令都通过 cmd /c 调用。PowerShell 5.1 会把原生命令
# 写入 stderr 的正常进度信息（Compiling… / Info…）升级为致命错误，
# 经 cmd 合并到 stdout 后可避免脚本被误中断。
#
# 依赖：Android SDK + NDK r27c + JDK 17 + Rust android targets + Gradle 9.6.1
# 用法：powershell -ExecutionPolicy Bypass -File build-android.ps1
# ============================================================
$ErrorActionPreference = 'Stop'

$src    = $PSScriptRoot
$build  = 'D:\build\geek-space'
$dist   = Join-Path $src 'dist'
$gradle = 'D:\gradle-9.6.1\bin\gradle.bat'
$abi    = 'arm64-v8a'
$flavor = 'Arm64'
$rustTarget = 'aarch64-linux-android'
$ksPass = 'geekspace2026'
$ksAlias = 'geekspace'

# ---------- 1/6 同步到 ASCII 构建目录 ----------
Write-Host "== 1/6 同步到 ASCII 构建目录 ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $build | Out-Null
robocopy "$src\geek-space" "$build\geek-space" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
# 排除构建产物目录（target 与 gen/android，后者内含 APK 签名配置）
robocopy "$src\src-tauri" "$build\src-tauri" /MIR /XD "$src\src-tauri\target" "$build\src-tauri\target" "$build\src-tauri\gen" /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$src\.cargo"     "$build\.cargo"     /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$src\node_modules\@tauri-apps" "$build\node_modules\@tauri-apps" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$src\node_modules\.bin"        "$build\node_modules\.bin"        /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item "$src\package.json" "$build\package.json" -Force

# ---------- 2/6 工具链 ----------
Write-Host "== 2/6 配置工具链 ==" -ForegroundColor Cyan
$env:PATH = "D:\msys64\msys64\mingw64\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_HOME = "$env:USERPROFILE\.cargo"
$env:RUSTUP_HOME = "$env:USERPROFILE\.rustup"
$env:RUSTUP_DIST_SERVER = "https://mirrors.tuna.tsinghua.edu.cn/rustup"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:ANDROID_NDK_HOME = "D:\android-ndk-r27c"
$env:NDK_HOME = $env:ANDROID_NDK_HOME
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
Write-Host "ANDROID_NDK_HOME = $env:ANDROID_NDK_HOME"

if (-not (Test-Path $gradle)) {
  throw "未找到 Gradle：$gradle`n请先从 https://mirrors.cloud.tencent.com/gradle/gradle-9.6.1-bin.zip 下载并解压到 D:\gradle-9.6.1"
}

$tauriCli = "$build\node_modules\.bin\tauri.cmd"

# ---------- 3/6 初始化 Android 工程 ----------
Set-Location $build
$androidDir = "$build\src-tauri\gen\android"
if (-not (Test-Path $androidDir)) {
  Write-Host "== 3/6 初始化 Android 工程 ==" -ForegroundColor Cyan
  cmd /c "`"$tauriCli`" android init --ci 2>&1"
}

# tauri.settings.gradle / app\tauri.build.gradle.kts / app\tauri.properties
# 这几个文件只由 `tauri android build` 产出，`android init` 不生成。
# 该命令最终会在「符号链接 .so 到 jniLibs」一步失败（Windows 非开发者模式
# 不允许创建符号链接），但此时 Gradle 配置已全部就绪，因此忽略其退出码，
# 后续由本脚本手动完成 .so 放置与 Gradle 打包。
if (-not (Test-Path "$androidDir\app\tauri.build.gradle.kts")) {
  Write-Host "== 3b/6 生成 Tauri Gradle 配置 ==" -ForegroundColor Cyan
  cmd /c "`"$tauriCli`" android build --apk --target aarch64 2>&1" | Out-Null
  Write-Host "  Gradle 配置已生成（CLI 可能在符号链接处报错，属预期）" -ForegroundColor Green
}

# ---------- 4/6 编译 Rust 并放置 .so ----------
Write-Host "== 4/6 编译 Rust ($rustTarget) ==" -ForegroundColor Cyan
Set-Location "$build\src-tauri"
cmd /c "cargo build --release --target $rustTarget 2>&1"
if ($LASTEXITCODE -ne 0) { throw "cargo build 失败（exit $LASTEXITCODE）" }

$soPath = "$build\src-tauri\target\$rustTarget\release\libgeek_space_lib.so"
if (-not (Test-Path $soPath)) { throw "未找到 $soPath" }
$jniDir = "$androidDir\app\src\main\jniLibs\$abi"
New-Item -ItemType Directory -Force -Path $jniDir | Out-Null
Copy-Item $soPath "$jniDir\libgeek_space_lib.so" -Force
Write-Host "  已放置 libgeek_space_lib.so -> $abi" -ForegroundColor Green

# ---------- 5/6 签名配置 ----------
$ksPath = "$androidDir\geek-space.keystore"
if (-not (Test-Path $ksPath)) {
  Write-Host "== 生成签名密钥库 ==" -ForegroundColor Yellow
  $kt = "$env:JAVA_HOME\bin\keytool.exe"
  cmd /c "`"$kt`" -genkeypair -v -keystore `"$ksPath`" -alias $ksAlias -keyalg RSA -keysize 2048 -validity 10000 -storepass $ksPass -keypass $ksPass -dname `"CN=Geek Space, OU=Personal, O=Geek Space, L=Guangzhou, ST=Guangdong, C=CN`" 2>&1"
  if ($LASTEXITCODE -ne 0) { throw "keytool 生成密钥库失败（exit $LASTEXITCODE）" }
}
# 源码目录保留一份密钥备份，便于换机构建时复用同一签名
$ksBackup = "$src\src-tauri\geek-space.keystore"
if ((-not (Test-Path $ksBackup)) -and (Test-Path $ksPath)) {
  Copy-Item $ksPath $ksBackup -Force
}

$gradleKts = "$androidDir\app\build.gradle.kts"
$content = Get-Content $gradleKts -Raw
if ($content -notmatch 'signingConfigs') {
  Write-Host "== 注入 release 签名配置 ==" -ForegroundColor Yellow
  $signing = @"
    signingConfigs {
        create("release") {
            storeFile = file("../geek-space.keystore")
            storePassword = "$ksPass"
            keyAlias = "$ksAlias"
            keyPassword = "$ksPass"
        }
    }
    buildTypes {
        getByName("debug") {
"@
  $content = $content -replace '(?m)^    buildTypes \{\r?\n        getByName\("debug"\) \{', $signing.TrimEnd()
  $content = $content -replace '(?m)^        getByName\("release"\) \{\r?\n', "        getByName(`"release`") {`r`n            signingConfig = signingConfigs.getByName(`"release`")`r`n"
  Set-Content $gradleKts $content -Encoding UTF8
  Write-Host "  已写入 signingConfigs" -ForegroundColor Green
}

# tauri.settings.gradle 由 `tauri android build` 生成，若上一步未产出则手工补上
$settingsFile = "$androidDir\tauri.settings.gradle"
if (-not (Test-Path $settingsFile)) {
  Write-Host "== 生成 tauri.settings.gradle ==" -ForegroundColor Yellow
  $regRoot = "$env:USERPROFILE\.cargo\registry\src"
  $tauriDir = Get-ChildItem $regRoot -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem $_.FullName -Directory -Filter 'tauri-2.*' -ErrorAction SilentlyContinue } |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $tauriDir) { throw "未在 cargo registry ($regRoot) 中找到 tauri 源码目录" }
  $androidModule = (Join-Path $tauriDir.FullName 'mobile\android')
  $escaped = $androidModule.Replace('\', '\\')
  $lines = @(
    '// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.',
    "include ':tauri-android'",
    "project(':tauri-android').projectDir = new File(`"$escaped`")"
  )
  # 必须写无 BOM 的 UTF-8：Groovy 无法解析带 BOM 的脚本
  $text = ($lines -join "`r`n") + "`r`n"
  [System.IO.File]::WriteAllText($settingsFile, $text, (New-Object System.Text.UTF8Encoding $false))
  Write-Host "  已生成 -> $androidModule" -ForegroundColor Green
}

# ---------- 6/6 Gradle 打包并拷回 ----------
Write-Host "== 6/6 Gradle 打包 ==" -ForegroundColor Cyan

# 同步版本号到 Android 工程。
# app/tauri.properties 只在 `tauri android build` 时生成；本脚本绕过了该命令
# （它在符号链接 .so 那步会失败），所以版本号会停留在上次成功生成的值上 ——
# 曾导致 APK 显示 0.2.0。这里按 Tauri 的同一套规则重新写入。
$cfgText = [System.IO.File]::ReadAllText("$build\src-tauri\tauri.conf.json", [System.Text.Encoding]::UTF8)
$ver = ($cfgText | ConvertFrom-Json).version
if (-not $ver) { throw "无法从 tauri.conf.json 读取 version" }
$vp = @($ver.Split('.') | ForEach-Object { [int]($_ -replace '\D', '') })
while ($vp.Count -lt 3) { $vp += 0 }
$vcode = $vp[0] * 1000000 + $vp[1] * 1000 + $vp[2]
$propText = @(
  '// THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.',
  "tauri.android.versionName=$ver",
  "tauri.android.versionCode=$vcode"
) -join "`r`n"
# .properties 必须无 BOM，否则 Java Properties 会把 BOM 当成第一个键名的一部分
[System.IO.File]::WriteAllText("$androidDir\app\tauri.properties", $propText + "`r`n", (New-Object System.Text.UTF8Encoding $false))
Write-Host "  Android 版本同步为 $ver (versionCode=$vcode)" -ForegroundColor Green

Set-Location $androidDir
cmd /c "`"$gradle`" assemble$flavor`Release --console=plain 2>&1"
if ($LASTEXITCODE -ne 0) { throw "Gradle 打包失败（exit $LASTEXITCODE）" }

New-Item -ItemType Directory -Force -Path "$dist\android" | Out-Null
Get-ChildItem -Recurse -Path "$androidDir\app\build\outputs\apk" -Filter '*.apk' -ErrorAction SilentlyContinue |
  ForEach-Object {
    $name = "极客空间-GeekSpace-$ver-$abi.apk"
    Copy-Item $_.FullName "$dist\android\$name" -Force
    Write-Host ("  -> dist\android\{0}  ({1} MB)" -f $name, [math]::Round($_.Length / 1MB, 2)) -ForegroundColor Green
  }
# 清掉历史版本，避免产物目录里堆积旧包
Get-ChildItem "$dist\android" -Filter '*.apk' -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch [regex]::Escape($ver) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host "`n构建完成，产物位于 $dist\android" -ForegroundColor Green
