@echo off
setlocal
set "ROOT=%~dp0.."
set "ISS=%~dp0ClashSwitchboard.iss"

if not exist "%ROOT%\native-host\clash-switchboard-host.exe" (
  echo 未找到 native-host\clash-switchboard-host.exe，正在尝试编译 Rust Native Host...
  call "%ROOT%\native-host\build-rust-host.bat"
  if errorlevel 1 exit /b 1
)

where iscc >nul 2>nul
if not errorlevel 1 (
  iscc "%ISS%"
  exit /b %ERRORLEVEL%
)

if exist "D:\app\Inno Setup 6\ISCC.exe" (
  "D:\app\Inno Setup 6\ISCC.exe" "%ISS%"
  exit /b %ERRORLEVEL%
)

if exist "D:\app\Inno Setup 6\ISCC.exe" (
  "D:\app\Inno Setup 6\ISCC.exe" "%ISS%"
  exit /b %ERRORLEVEL%
)

echo 未找到 Inno Setup 编译器 ISCC.exe。
echo 请安装 Inno Setup 6: https://jrsoftware.org/isinfo.php
echo 或先使用 installer\install-app.bat 做本机安装测试。
exit /b 1
