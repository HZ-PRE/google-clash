@echo off
setlocal EnableExtensions

set "APP_NAME=ClashSwitchboard"
set "HOST_NAME=com.clash_switchboard.mihomo"
set "EXT_ID=aggoidfhenhmcjdahailamnlingebmem"
set "SRC_ROOT=%~dp0.."
set "INSTALL_DIR=%LOCALAPPDATA%\%APP_NAME%"
set "EXT_DIR=%INSTALL_DIR%\extension"
set "NATIVE_HOST_DIR=%INSTALL_DIR%\native-host"
set "CORE_DIR=%INSTALL_DIR%\core"
set "HOST_MANIFEST=%NATIVE_HOST_DIR%\%HOST_NAME%.json"
set "HOST_EXE=%NATIVE_HOST_DIR%\clash-switchboard-host.exe"
set "CHROME_POLICY_KEY=HKCU\Software\Google\Chrome\Extensions\%EXT_ID%"
set "NATIVE_KEY=HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%"

echo 正在安装 %APP_NAME%...

if not exist "%SRC_ROOT%\native-host\clash-switchboard-host.exe" (
  echo 未找到 native-host\clash-switchboard-host.exe
  echo 请先运行 native-host\build-rust-host.bat
  exit /b 1
)

if not exist "%SRC_ROOT%\core\nb-mihomo.exe" (
  echo 未找到 core\nb-mihomo.exe
  exit /b 1
)

mkdir "%INSTALL_DIR%" 2>nul
mkdir "%EXT_DIR%" 2>nul
mkdir "%NATIVE_HOST_DIR%" 2>nul
mkdir "%CORE_DIR%" 2>nul

copy /Y "%SRC_ROOT%\manifest.json" "%EXT_DIR%\" >nul
copy /Y "%SRC_ROOT%\background.js" "%EXT_DIR%\" >nul
copy /Y "%SRC_ROOT%\clash-api.js" "%EXT_DIR%\" >nul
copy /Y "%SRC_ROOT%\popup.html" "%EXT_DIR%\" >nul
copy /Y "%SRC_ROOT%\popup.js" "%EXT_DIR%\" >nul
copy /Y "%SRC_ROOT%\options.html" "%EXT_DIR%\" >nul
copy /Y "%SRC_ROOT%\options.js" "%EXT_DIR%\" >nul
copy /Y "%SRC_ROOT%\styles.css" "%EXT_DIR%\" >nul
xcopy /E /I /Y "%SRC_ROOT%\icons" "%EXT_DIR%\icons" >nul

copy /Y "%SRC_ROOT%\native-host\clash-switchboard-host.exe" "%NATIVE_HOST_DIR%\" >nul
copy /Y "%SRC_ROOT%\native-host\uninstall-native-host.bat" "%NATIVE_HOST_DIR%\" >nul
copy /Y "%SRC_ROOT%\core\nb-mihomo.exe" "%CORE_DIR%\" >nul
if exist "%SRC_ROOT%\core\config.yaml" copy /Y "%SRC_ROOT%\core\config.yaml" "%CORE_DIR%\" >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$path='%HOST_MANIFEST%'; $exe='%HOST_EXE%'; $id='%EXT_ID%'; $obj=[ordered]@{ name='%HOST_NAME%'; description='Mihomo launcher for Clash Switchboard'; path=$exe; type='stdio'; allowed_origins=@('chrome-extension://' + $id + '/') }; $json=$obj | ConvertTo-Json -Depth 5; [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))"
if errorlevel 1 exit /b 1

reg add "%NATIVE_KEY%" /ve /t REG_SZ /d "%HOST_MANIFEST%" /f >nul
if errorlevel 1 exit /b 1

reg add "%CHROME_POLICY_KEY%" /v "path" /t REG_SZ /d "%EXT_DIR%\manifest.json" /f >nul
reg add "%CHROME_POLICY_KEY%" /v "version" /t REG_SZ /d "1.0.0" /f >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$un='%INSTALL_DIR%\uninstall.bat'; $content='@echo off`r`nreg delete ""%NATIVE_KEY%"" /f 2^>nul`r`nreg delete ""%CHROME_POLICY_KEY%"" /f 2^>nul`r`nrd /s /q ""%INSTALL_DIR%""`r`necho ClashSwitchboard 已卸载。`r`npause`r`n'; [System.IO.File]::WriteAllText($un, $content, [System.Text.Encoding]::Default)"

echo.
echo 安装完成。
echo 安装目录: %INSTALL_DIR%
echo 扩展ID: %EXT_ID%
echo.
echo 请完全关闭并重新打开 Chrome，或打开 chrome://extensions/ 检查插件是否已安装。
echo 如果 Chrome 没有自动加载插件，请开启开发者模式并手动加载: %EXT_DIR%
pause
