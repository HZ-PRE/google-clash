@echo off
setlocal EnableExtensions

set "HOST_NAME=com.clash_switchboard.mihomo"
set "EXT_ID=aggoidfhenhmcjdahailamnlingebmem"
set "INST=%LOCALAPPDATA%\ClashSwitchboard"
set "NH=%INST%\native-host"
set "MANIFEST=%NH%\%HOST_NAME%.json"
set "HOST_EXE=%NH%\clash-switchboard-host.exe"

echo === Register Native Host ===
echo.

mkdir "%NH%" 2>nul
copy /Y "%~dp0clash-switchboard-host.exe" "%HOST_EXE%" >nul

echo {"name":"%HOST_NAME%","description":"Mihomo launcher for Clash Switchboard","path":"%HOST_EXE:\=\\%","type":"stdio","allowed_origins":["chrome-extension://%EXT_ID%/"]} > "%MANIFEST%"

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /t REG_SZ /d "%MANIFEST%" /f >nul

echo Manifest: %MANIFEST%
echo.
type "%MANIFEST%"
echo.
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve

echo.
echo Done. Please restart Chrome.
