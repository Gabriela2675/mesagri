@echo off
rem Mesagri - DETENER (doble clic)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\detener.ps1"
echo.
pause
