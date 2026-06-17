@echo off
setlocal
set "HOST_NAME=com.clash_switchboard.mihomo"
set "HOST_DIR=%~dp0"
set "HOST_EXE=%HOST_DIR%clash-switchboard-host.exe"
set "HOST_MANIFEST=%HOST_DIR%%HOST_NAME%.json"

if "%~1"=="" (
  echo 用法: install-native-host.bat ^<Chrome插件ID^>
  echo 例如: install-native-host.bat aggoidfhenhmcjdahailamnlingebmem
  exit /b 1
)

if not exist "%HOST_EXE%" (
  echo 未找到 Native Host: %HOST_EXE%
  echo 请先运行 build-rust-host.bat 编译 Rust 单文件 exe。
  exit /b 1
)

set "EXT_ID=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$path='%HOST_MANIFEST%'; $exe='%HOST_EXE%'; $id='%EXT_ID%'; $obj=[ordered]@{ name='%HOST_NAME%'; description='可牛块垒加速器'; path=$exe; type='stdio'; allowed_origins=@('chrome-extension://' + $id + '/') }; $json=$obj | ConvertTo-Json -Depth 5; [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))"
if errorlevel 1 exit /b 1

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%HOST_MANIFEST%" /f
if errorlevel 1 exit /b 1

echo Native Host 已注册: %HOST_MANIFEST%
echo Native Host EXE: %HOST_EXE%
echo 请重新加载 Chrome 插件。
