@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "LOCKFILE=.data\ash-ai.lock"
if not exist ".data" mkdir ".data"

if exist "%LOCKFILE%" (
  echo ASH AI appears to be running already.
  echo Open http://127.0.0.1:3035
  echo If that fails, delete .data\ash-ai.lock and run this file again.
  start "" "http://127.0.0.1:3035"
  exit /b 0
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24.13+ is required. Install it, then run this file again.
  exit /b 1
)

if not exist "node_modules\pdfjs-dist" (
  echo Installing local platform dependencies...
  call npm.cmd install
  if errorlevel 1 exit /b 1
)

if not exist ".env.local" (
  echo Creating .env.local from .env.example
  copy /Y ".env.example" ".env.local" >nul
  powershell -NoProfile -Command "$key = -join ((1..40) | ForEach-Object { [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' | Get-Random }); (Get-Content '.env.local') -replace 'ASH_PLATFORM_BOOTSTRAP_KEY=', ('ASH_PLATFORM_BOOTSTRAP_KEY=' + $key) -replace 'ASH_PLATFORM_INVITE_CODE=', ('ASH_PLATFORM_INVITE_CODE=' + $key) | Set-Content '.env.local'"
  echo A private access code was generated in .env.local. Optional cloud keys can be added later.
)

echo starting>"%LOCKFILE%"
echo Checking Ollama...
curl.exe -s -m 2 http://127.0.0.1:11434/api/tags >nul 2>&1
if errorlevel 1 echo Ollama is not responding. Local models will be unavailable until it is started.

start "ASH AI" /MIN cmd /c "node --experimental-strip-types src\main.ts"

echo Waiting for ASH AI...
set /a tries=0
:wait_backend
set /a tries+=1
curl.exe -s -m 2 http://127.0.0.1:3035/api/v1/health | findstr /C:"\"status\":\"ok\"" >nul
if errorlevel 1 (
  if %tries% GEQ 30 goto fail
  timeout /t 1 /nobreak >nul
  goto wait_backend
)

echo Local ASH Chat: http://127.0.0.1:3035
echo Phone PWA: use npm.cmd run lan-https after creating a private certificate. Default upstream port is 3035.
start "" "http://127.0.0.1:3035"
echo Running. Close this window to stop ASH AI.
pause
goto cleanup

:fail
echo ASH AI did not become healthy. Check that port 3035 is free and Node 24 is installed.

:cleanup
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3035" ^| findstr LISTENING') do taskkill /PID %%p /F >nul 2>&1
if exist "%LOCKFILE%" del "%LOCKFILE%"
endlocal
