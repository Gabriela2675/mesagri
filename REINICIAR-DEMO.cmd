@echo off
rem Mesagri - REINICIAR-DEMO (doble clic)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\reiniciar-demo.ps1"
echo.
pause
