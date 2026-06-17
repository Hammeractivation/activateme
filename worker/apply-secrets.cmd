@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-secrets.ps1" %*
exit /b %ERRORLEVEL%
