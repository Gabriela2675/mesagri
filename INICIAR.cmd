@echo off
rem Mesagri - INICIAR (doble clic)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\iniciar.ps1"
echo.
pause
