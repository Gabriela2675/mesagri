@echo off
rem Mesagri - INSTALAR (doble clic)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\instalar.ps1"
echo.
pause
