@echo off
setlocal enabledelayedexpansion
title Framer - Install

rem ---------------------------------------------------------------------------
rem  Framer installer for Windows.
rem  Copies the panel into Premiere's user extension folder and tells CEP that
rem  unsigned extensions are allowed to load. Nothing needs admin rights,
rem  because everything lives under the current user's AppData.
rem
rem  Switches:  /silent    no prompts, no pause at the end
rem ---------------------------------------------------------------------------

set "EXT_ID=com.niterix.framer"
set "DEST=%APPDATA%\Adobe\CEP\extensions\%EXT_ID%"
set "SILENT=0"

for %%A in (%*) do (
  if /i "%%~A"=="/silent" set "SILENT=1"
)

echo.
echo  ===========================================
echo    Framer for Premiere Pro
echo  ===========================================
echo.

rem --- locate the payload ----------------------------------------------------
set "SRC="
if exist "%~dp0extension\CSXS\manifest.xml" set "SRC=%~dp0extension"
if not defined SRC if exist "%~dp0..\..\extension\CSXS\manifest.xml" set "SRC=%~dp0..\..\extension"
if not defined SRC if exist "%~dp0..\extension\CSXS\manifest.xml" set "SRC=%~dp0..\extension"

if not defined SRC (
  echo  [X] Could not find the "extension" folder next to this installer.
  echo      Keep Install-Windows.bat in the same folder as "extension".
  goto :fail
)

rem --- is Premiere running? --------------------------------------------------
tasklist /fi "imagename eq Adobe Premiere Pro.exe" 2>nul | find /i "Adobe Premiere Pro.exe" >nul
if not errorlevel 1 (
  echo  [!] Premiere Pro is open. The panel will only appear after you restart it.
  echo.
)

rem --- copy ------------------------------------------------------------------
echo  Installing to:
echo    %DEST%
echo.

if exist "%DEST%" (
  rd /s /q "%DEST%" 2>nul
)
mkdir "%DEST%" 2>nul
xcopy "%SRC%\*" "%DEST%\" /e /i /q /y >nul
if errorlevel 1 (
  echo  [X] Copy failed. Close Premiere Pro and run this again.
  goto :fail
)
echo  [ok] Panel files copied.

rem --- allow unsigned extensions --------------------------------------------
for %%V in (6 7 8 9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo  [ok] Unsigned extensions enabled for CEP 6-12.

echo.
echo  ===========================================
echo    Done.
echo.
echo    Restart Premiere Pro, then open:
echo      Window  ^>  Extensions  ^>  Framer
echo.
echo    One setting matters: in Premiere,
echo      Edit ^> Preferences ^> Media ^> Default Media Scaling
echo    must be set to "None", or Premiere rescales the
echo    clips Framer places and the layers will not line up.
echo  ===========================================
echo.
if "%SILENT%"=="0" pause
exit /b 0

:fail
echo.
if "%SILENT%"=="0" pause
exit /b 1
