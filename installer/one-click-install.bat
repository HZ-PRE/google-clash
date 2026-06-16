@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul

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

echo.
echo  ========================================
echo   Clash Switchboard - One-Click Install
echo  ========================================
echo.

:: Step 1: Build Native Host if needed
echo [1/5] Checking Native Host ...
if not exist "%SRC_ROOT%\native-host\clash-switchboard-host.exe" (
  echo       Building Rust Native Host ...
  where cargo >nul 2>nul
  if errorlevel 1 (
    echo       [ERROR] Rust/Cargo not found. Install: https://www.rust-lang.org/tools/install
    pause
    exit /b 1
  )
  pushd "%SRC_ROOT%\native-host-rust"
  cargo build --release
  if errorlevel 1 (
    echo       [ERROR] Rust build failed
    popd
    pause
    exit /b 1
  )
  copy /Y "%SRC_ROOT%\native-host-rust\target\release\clash-switchboard-host.exe" "%SRC_ROOT%\native-host\clash-switchboard-host.exe" >nul
  popd
  echo       Build OK
) else (
  echo       Ready
)

:: Step 2: Check Mihomo core
echo [2/5] Checking Mihomo core ...
if not exist "%SRC_ROOT%\core\nb-mihomo.exe" (
  echo       [ERROR] core\nb-mihomo.exe not found
  echo       Please place nb-mihomo.exe in the core\ directory
  pause
  exit /b 1
)
echo       Ready

:: Step 3: Copy files to install directory
echo [3/5] Installing files ...
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
echo       Files copied OK

:: Step 4: Register Native Host and Chrome extension policy
echo [4/5] Registering Native Host and Chrome policies ...

powershell -NoProfile -ExecutionPolicy Bypass -Command "$path='%HOST_MANIFEST%'; $exe='%HOST_EXE%'; $id='%EXT_ID%'; $obj=[ordered]@{ name='%HOST_NAME%'; description='Mihomo launcher for Clash Switchboard'; path=$exe; type='stdio'; allowed_origins=@('chrome-extension://' + $id + '/') }; $json=$obj | ConvertTo-Json -Depth 5; [System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))"
if errorlevel 1 (
  echo       [ERROR] Failed to generate Native Host manifest
  pause
  exit /b 1
)

reg add "%NATIVE_KEY%" /ve /t REG_SZ /d "%HOST_MANIFEST%" /f >nul
if errorlevel 1 (
  echo       [ERROR] Failed to register Native Messaging Host
  pause
  exit /b 1
)

reg add "%CHROME_POLICY_KEY%" /v "path" /t REG_SZ /d "%EXT_DIR%\manifest.json" /f >nul
reg add "%CHROME_POLICY_KEY%" /v "version" /t REG_SZ /d "1.0.0" /f >nul
echo       Registration OK

:: Step 5: Auto-install Chrome extension
echo [5/5] Installing Chrome extension ...

set "CHROME="
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if not defined CHROME (
  echo       [WARN] Chrome not found
  echo       Extension registered via policy, will load on Chrome startup
  goto :create_uninstaller
)

:: Check if Chrome is running
tasklist /FI "IMAGENAME eq chrome.exe" /NH 2>nul | find /i "chrome.exe" >nul

if errorlevel 1 (
  :: Chrome not running - launch with extension
  echo       Launching Chrome with extension ...
  start "" "%CHROME%" --load-extension="%EXT_DIR%"
  timeout /t 3 /nobreak >nul
  echo       Chrome launched with extension
) else (
  :: Chrome is running - need restart for policy to take effect
  echo       Chrome is running, restarting to load extension ...
  taskkill /IM chrome.exe /F >nul 2>&1
  timeout /t 2 /nobreak >nul
  start "" "%CHROME%"
  timeout /t 3 /nobreak >nul
  echo       Chrome restarted, extension will auto-load
)

:: Create uninstaller
:create_uninstaller

powershell -NoProfile -ExecutionPolicy Bypass -Command "$un='%INSTALL_DIR%\uninstall.bat'; $content='@echo off`r`nreg delete ""HKCU\Software\Google\Chrome\NativeMessagingHosts\com.clash_switchboard.mihomo"" /f 2^>nul`r`nreg delete ""HKCU\Software\Google\Chrome\Extensions\%EXT_ID%"" /f 2^>nul`r`nrd /s /q ""%INSTALL_DIR%""`r`necho ClashSwitchboard uninstalled.`r`npause`r`n'; [System.IO.File]::WriteAllText($un, $content, [System.Text.Encoding]::Default)"

echo.
echo  ========================================
echo   Install Complete!
echo  ========================================
echo.
echo   Install dir : %INSTALL_DIR%
echo   Extension ID: %EXT_ID%
echo   Uninstall   : %INSTALL_DIR%\uninstall.bat
echo.
echo   Tips:
echo   - If extension not loaded, fully close and reopen Chrome
echo   - Check chrome://extensions/ for extension status
echo   - Manual load path: %EXT_DIR%
echo.
pause
