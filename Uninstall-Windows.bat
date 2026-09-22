@echo off
setlocal
title Framer - Uninstall

rem ---------------------------------------------------------------------------
rem  Removes the Framer panel from Premiere's user extension folder.
rem  The CEP "unsigned extensions allowed" setting is left alone on purpose:
rem  other unsigned panels may rely on it.
rem ---------------------------------------------------------------------------

set "EXT_ID=com.niterix.framer"
set "DEST=%APPDATA%\Adobe\CEP\extensions\%EXT_ID%"

echo.
echo  Removing Framer...
echo    %DEST%
echo.

if not exist "%DEST%" (
  echo  [--] Nothing to remove - Framer is not installed there.
  goto :done
)

rd /s /q "%DEST%"
if exist "%DEST%" (
  echo  [X] Could not remove it. Close Premiere Pro and try again.
  pause
  exit /b 1
)
echo  [ok] Removed.

:done
echo.
echo  Restart Premiere Pro to clear the panel from the Extensions menu.
echo.
pause
exit /b 0
