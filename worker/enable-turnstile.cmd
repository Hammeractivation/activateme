@echo off
cd /d "%~dp0"
set "NODE=%ProgramFiles%\nodejs\node.exe"
set "WRANGLER=%~dp0node_modules\wrangler\bin\wrangler.js"

echo [1/3] Provision Turnstile keys...
"%NODE%" scripts\provision-turnstile.mjs
if %ERRORLEVEL% NEQ 0 exit /b 1

echo.
echo [2/3] Upload TURNSTILE_SECRET_KEY to Worker...
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /B "TURNSTILE_SECRET_KEY=" secrets.local.env`) do (
  set "TURNSTILE_VAL=%%B"
)
if not defined TURNSTILE_VAL (
  echo ERROR: TURNSTILE_SECRET_KEY missing in secrets.local.env
  exit /b 1
)
set WRANGLER_SEND_METRICS=false
echo %TURNSTILE_VAL%| "%NODE%" "%WRANGLER%" secret put TURNSTILE_SECRET_KEY
if %ERRORLEVEL% NEQ 0 exit /b 1

echo.
echo [3/3] Deploy worker...
call wrangler.cmd deploy
if %ERRORLEVEL% NEQ 0 exit /b 1

echo.
echo Done. Push activateme/docs to GitHub Pages so the site key goes live.
