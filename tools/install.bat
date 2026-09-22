@echo off
REM Install Framer into Premiere Pro on Windows.
REM
REM   tools\install.bat             copy this checkout into the CEP folder
REM   tools\install.bat /link       symlink instead (needs an elevated prompt)
REM   tools\install.bat /uninstall
REM
REM An unsigned extension only loads when CEP debug mode is on, which this
REM turns on for every CEP version Premiere has shipped since CC 2019.

setlocal
set BUNDLE_ID=com.niterix.framer
set SOURCE_DIR=%~dp0..
set EXT_DIR=%APPDATA%\Adobe\CEP\extensions
set TARGET=%EXT_DIR%\%BUNDLE_ID%

if /I "%~1"=="/uninstall" goto uninstall

if not exist "%EXT_DIR%" mkdir "%EXT_DIR%"
if exist "%TARGET%" rmdir /S /Q "%TARGET%" 2>nul

if /I "%~1"=="/link" (
  mklink /D "%TARGET%" "%SOURCE_DIR%"
  if errorlevel 1 (
    echo.
    echo Could not create the link - run this from an elevated prompt, or
    echo re-run without /link to copy the files instead.
    goto end
  )
  echo Linked %TARGET%
) else (
  mkdir "%TARGET%"
  for %%D in (CSXS css icons js jsx) do xcopy /E /I /Y /Q "%SOURCE_DIR%\%%D" "%TARGET%\%%D" >nul
  copy /Y "%SOURCE_DIR%\index.html" "%TARGET%\" >nul
  copy /Y "%SOURCE_DIR%\.debug" "%TARGET%\" >nul
  echo Copied the extension to %TARGET%
)

for %%V in (9 10 11 12) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo CEP debug mode enabled ^(CSXS 9-12^)
echo.
echo Restart Premiere Pro, then open:  Window ^> Extensions ^> Framer ^(Vertical Reframe^)
goto end

:uninstall
if exist "%TARGET%" (
  rmdir /S /Q "%TARGET%"
  echo Removed %TARGET%
) else (
  echo Nothing installed at %TARGET%
)

:end
endlocal
