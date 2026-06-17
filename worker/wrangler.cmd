@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
if not exist "node_modules\wrangler\bin\wrangler.js" (
  echo Installing worker packages...
  call npm.cmd install
)
node "%~dp0node_modules\wrangler\bin\wrangler.js" %*
exit /b %ERRORLEVEL%
