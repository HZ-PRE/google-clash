@echo off
setlocal EnableExtensions

set "ROOT=%~dp0.."
set "ISS=%~dp0ClashSwitchboardLegacyChrome.iss"

if not exist "%ROOT%\manifest.v2.json" (
  echo 未找到 manifest.v2.json，无法构建旧版 Chrome 兼容安装包。
  exit /b 1
)

if not exist "%ROOT%\native-host\clash-switchboard-host.exe" (
  echo 未找到 native-host\clash-switchboard-host.exe，正在尝试编译 Rust Native Host...
  call "%ROOT%\native-host\build-rust-host.bat"
  if errorlevel 1 exit /b 1
)

where iscc >nul 2>nul
if not errorlevel 1 (
  iscc "%ISS%"
  if errorlevel 1 exit /b 1
  exit /b 0
)

if exist "D:\app\Inno Setup 6\ISCC.exe" (
  "D:\app\Inno Setup 6\ISCC.exe" "%ISS%"
  if errorlevel 1 exit /b 1
  exit /b 0
)

echo 未找到 Inno Setup 编译器 ISCC.exe。
echo 请安装 Inno Setup 6: https://jrsoftware.org/isinfo.php
echo 或先使用 installer\install-app-legacy-chrome.bat 做本机旧版 Chrome 安装测试。
exit /b 1
