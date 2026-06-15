@echo off
setlocal
set "ROOT=%~dp0.."
set "RUST_DIR=%ROOT%\native-host-rust"
set "OUT_EXE=%~dp0clash-switchboard-host.exe"

where cargo >nul 2>nul
if errorlevel 1 (
  echo 未找到 Rust/Cargo。请先安装 Rust: https://www.rust-lang.org/tools/install
  exit /b 1
)

cd /d "%RUST_DIR%"
cargo build --release
if errorlevel 1 exit /b 1

copy /Y "%RUST_DIR%\target\release\clash-switchboard-host.exe" "%OUT_EXE%" >nul
if errorlevel 1 exit /b 1

echo 编译完成: %OUT_EXE%
