@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "EXT_ID=aggoidfhenhmcjdahailamnlingebmem"
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "EXT_DIR=%PROJECT_DIR%\extension"
set "INST_DIR=%PROJECT_DIR%\installer"
set "CRX_PATH=%INST_DIR%\clash-switchboard.crx"
set "PEM_PATH=%INST_DIR%\clash-switchboard.pem"
set "UPDATE_XML=%INST_DIR%\update.xml"
set "SERVER_PORT=8765"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator privileges...
  powershell -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

echo ============================================
echo  Clash Switchboard Enterprise Auto-Install
echo ============================================
echo.

if not exist "%EXT_DIR%\manifest.json" (
  echo Extension directory not found, creating from project source...
  mkdir "%EXT_DIR%" 2>nul
  copy /Y "%PROJECT_DIR%\manifest.json" "%EXT_DIR%\" >nul
  copy /Y "%PROJECT_DIR%\background.js" "%EXT_DIR%\" >nul
  copy /Y "%PROJECT_DIR%\clash-api.js" "%EXT_DIR%\" >nul
  copy /Y "%PROJECT_DIR%\popup.html" "%EXT_DIR%\" >nul
  copy /Y "%PROJECT_DIR%\popup.js" "%EXT_DIR%\" >nul
  copy /Y "%PROJECT_DIR%\options.html" "%EXT_DIR%\" >nul
  copy /Y "%PROJECT_DIR%\options.js" "%EXT_DIR%\" >nul
  copy /Y "%PROJECT_DIR%\styles.css" "%EXT_DIR%\" >nul
  xcopy /E /I /Y "%PROJECT_DIR%\icons" "%EXT_DIR%\icons" >nul
)

if not exist "%EXT_DIR%\manifest.json" (
  echo ERROR: Failed to create extension directory: %EXT_DIR%
  echo Ensure project source files exist in: %PROJECT_DIR%
  pause
  exit /b 1
)

:: Step 1: Create CRX
if not exist "%CRX_PATH%" (
  echo Creating CRX file...
  set "CHROME="
  if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
  if not defined CHROME if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
  if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
  
  if defined CHROME (
    taskkill /IM chrome.exe /F >nul 2>&1
    timeout /t 2 /nobreak >nul
    if exist "%PEM_PATH%" (
      "%CHROME%" --pack-extension="%EXT_DIR%" --pack-extension-key="%PEM_PATH%" --no-first-run >nul 2>&1
    ) else (
      "%CHROME%" --pack-extension="%EXT_DIR%" --no-first-run >nul 2>&1
    )
    if exist "%EXT_DIR%.crx" move /Y "%EXT_DIR%.crx" "%CRX_PATH%" >nul 2>&1
    if exist "%EXT_DIR%.pem" move /Y "%EXT_DIR%.pem" "%PEM_PATH%" >nul 2>&1
  )
  
  if not exist "%CRX_PATH%" (
    echo WARNING: CRX creation failed. Trying without Chrome packaging.
    echo Creating empty CRX placeholder for policy testing...
    powershell -Command "[IO.File]::WriteAllBytes('%CRX_PATH%', [IO.File]::ReadAllBytes('%EXT_DIR%\manifest.json'))"
  )
)

:: Step 2: Create update.xml
echo Creating update.xml...
(
echo ^<?xml version="1.0" encoding="UTF-8"?^>
echo ^<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0"^>
echo   ^<app appid="%EXT_ID%"^>
echo     ^<updatecheck codebase="http://localhost:%SERVER_PORT%/clash-switchboard.crx" version="1.0.0" /^>
echo   ^</app^>
echo ^</gupdate^>
) > "%UPDATE_XML%"

:: Step 3: Set registry policies
echo Setting Chrome enterprise policies...

reg add "HKLM\Software\Policies\Google\Chrome" /f >nul 2>&1

reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallSources" /v 1 /t REG_SZ /d "http://localhost:*" /f >nul 2>&1

reg delete "HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /f >nul 2>&1
reg add "HKLM\Software\Policies\Google\Chrome\ExtensionInstallForcelist" /v 1 /t REG_SZ /d "%EXT_ID%;http://localhost:%SERVER_PORT%/update.xml" /f >nul 2>&1

echo.
echo ============================================
echo  Policies configured.
echo ============================================
echo.
echo Now starting local update server on port %SERVER_PORT%...
echo Keep this window open until Chrome installs the extension.
echo.
echo After Chrome loads the extension, close this window.
echo.

:: Step 4: Start PowerShell HTTP server to serve CRX + update.xml
powershell -NoProfile -ExecutionPolicy Bypass -Command "
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add('http://localhost:%SERVER_PORT%/')
  $listener.Start()
  Write-Host 'Server started on http://localhost:%SERVER_PORT%/'
  Write-Host 'Files being served:'
  Write-Host '  %UPDATE_XML%'
  Write-Host '  %CRX_PATH%'
  Write-Host ''
  
  $paths = @{
    '/update.xml' = '%UPDATE_XML%'
    '/clash-switchboard.crx' = '%CRX_PATH%'
  }
  
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath
    Write-Host ('[REQUEST] ' + $ctx.Request.HttpMethod + ' ' + $path)
    
    if ($paths.ContainsKey($path)) {
      $file = $paths[$path]
      if (Test-Path $file) {
        $data = [IO.File]::ReadAllBytes($file)
        if ($path.EndsWith('.xml')) {
          $ctx.Response.ContentType = 'text/xml'
        } else {
          $ctx.Response.ContentType = 'application/x-chrome-extension'
        }
        $ctx.Response.OutputStream.Write($data, 0, $data.Length)
        Write-Host ('[SERVED] ' + $path + ' (' + $data.Length + ' bytes)')
      } else {
        $ctx.Response.StatusCode = 404
        Write-Host ('[404] File not found: ' + $file)
      }
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  }
"

pause
