# ============================================================
# 极客空间 Geek Space — Windows 安装包构建
# ------------------------------------------------------------
# 两个已知坑，脚本已自动处理：
#   1. MinGW-w64 的 dlltool/windres 无法处理含中文的路径
#      → 先把工程同步到纯 ASCII 目录 D:\build\geek-space 再编译
#   2. Tauri 打包 NSIS 时会从 GitHub 下载工具链，国内直连超时
#      → 预先经加速代理部署到 %LOCALAPPDATA%\tauri\NSIS
#
# 依赖：MSYS2(MinGW-w64 GCC) + Rust GNU 工具链 + WebView2 Runtime
# 用法：powershell -ExecutionPolicy Bypass -File build-windows.ps1
# ============================================================
$ErrorActionPreference = 'Stop'

$src   = $PSScriptRoot
$build = 'D:\build\geek-space'
$dist  = Join-Path $src 'dist'

# ---------- 0/5 预置 NSIS 打包工具 ----------
$cacheDir = Join-Path $env:LOCALAPPDATA 'tauri'
$nsisDir  = Join-Path $cacheDir 'NSIS'
$pluginDll = Join-Path $nsisDir 'Plugins\x86-unicode\additional\nsis_tauri_utils.dll'
$needNsis = (-not (Test-Path (Join-Path $nsisDir 'Bin\makensis.exe'))) -or (-not (Test-Path $pluginDll))

if ($needNsis) {
  Write-Host "== 0/5 预置 NSIS 打包工具（走加速代理）==" -ForegroundColor Yellow
  $tmp = Join-Path $env:TEMP 'gs-nsis'
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $proxy = 'https://ghfast.top/'
  $nsisZip = Join-Path $tmp 'nsis.zip'
  $utilsDll = Join-Path $tmp 'nsis_tauri_utils.dll'
  if (-not (Test-Path $nsisZip)) {
    Invoke-WebRequest "${proxy}https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.13/nsis-3.13.zip" -OutFile $nsisZip
  }
  if (-not (Test-Path $utilsDll)) {
    Invoke-WebRequest "${proxy}https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll" -OutFile $utilsDll
  }
  Remove-Item -Recurse -Force $nsisDir -ErrorAction SilentlyContinue
  Expand-Archive $nsisZip -DestinationPath $tmp -Force
  Move-Item (Join-Path $tmp 'nsis-3.13') $nsisDir -Force
  New-Item -ItemType Directory -Force -Path (Split-Path $pluginDll) | Out-Null
  Copy-Item $utilsDll $pluginDll -Force
  Write-Host "  NSIS 就绪" -ForegroundColor Green
}

# ---------- 1/5 同步到 ASCII 构建目录 ----------
Write-Host "== 1/5 同步到 ASCII 构建目录 ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $build | Out-Null
robocopy "$src\geek-space" "$build\geek-space" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$src\src-tauri"  "$build\src-tauri"  /MIR /XD "$src\src-tauri\target" "$build\src-tauri\target" "$build\src-tauri\gen" /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$src\.cargo"     "$build\.cargo"     /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$src\node_modules\@tauri-apps" "$build\node_modules\@tauri-apps" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy "$src\node_modules\.bin"        "$build\node_modules\.bin"        /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item "$src\package.json" "$build\package.json" -Force

# ---------- 2/5 工具链 ----------
Write-Host "== 2/5 配置工具链 ==" -ForegroundColor Cyan
$env:PATH = "D:\msys64\msys64\mingw64\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"
$env:CARGO_HOME = "$env:USERPROFILE\.cargo"
$env:RUSTUP_HOME = "$env:USERPROFILE\.rustup"
$env:RUSTUP_DIST_SERVER = "https://mirrors.tuna.tsinghua.edu.cn/rustup"
$env:RUSTUP_UPDATE_ROOT = "https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup"
rustc -vV | Select-String 'host:'
cmd /c "gcc --version 2>&1" | Select-Object -First 1

# ---------- 3/5 编译打包 ----------
Write-Host "== 3/5 编译打包 ==" -ForegroundColor Cyan
Set-Location $build
# 经 cmd /c 调用：PowerShell 5.1 会把原生程序写到 stderr 的正常进度
# 信息（Compiling… / Info…）升级为致命错误，合并到 stdout 可避免误中断
cmd /c "`"$build\node_modules\.bin\tauri.cmd`" build $($args -join ' ') 2>&1"
if ($LASTEXITCODE -ne 0) { throw "tauri build 失败（exit $LASTEXITCODE）" }

# ---------- 4/5 拷回产物 ----------
Write-Host "== 4/5 拷回产物 ==" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "$dist\windows" | Out-Null
Get-ChildItem -Path "$build\src-tauri\target\release\bundle\nsis" -Filter '*setup.exe' -ErrorAction SilentlyContinue |
  ForEach-Object {
    $name = "极客空间-GeekSpace-$($_.BaseName.Split('_')[-2])-安装包.exe"
    Copy-Item $_.FullName "$dist\windows\$name" -Force
    Write-Host ("  -> dist\windows\{0}  ({1} MB)" -f $name, [math]::Round($_.Length / 1MB, 2)) -ForegroundColor Green
  }
# 读取版本号：必须显式按 UTF-8 读，PowerShell 5.1 的 Get-Content -Raw
# 会按系统 ANSI 代码页解码，tauri.conf.json 里的中文会被破坏成非法 JSON。
$cfgText = [System.IO.File]::ReadAllText("$build\src-tauri\tauri.conf.json", [System.Text.Encoding]::UTF8)
$ver = ($cfgText | ConvertFrom-Json).version
if (-not $ver) { $ver = 'unknown' }

# 仅交付 NSIS 安装包，不产出便携版。
# 若日后需要绿色版：把 target\release 下的 geek-space.exe 与
# WebView2Loader.dll 放到同一个目录即可 —— 缺 DLL 会报 0xC0000135。
# （安装包内这两个文件由 Tauri 自行打入，不受影响。）

# 清掉历史版本，避免产物目录里堆积旧包
Get-ChildItem "$dist\windows" -Filter "*0.*" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch [regex]::Escape($ver) } |
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`n== 5/5 完成，产物位于 $dist\windows ==" -ForegroundColor Green
