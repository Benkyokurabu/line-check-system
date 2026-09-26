@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo Installation failed. Please keep this window open and report the message above.
  pause
  exit /b 1
)
echo Installation completed.
pause
