@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from nodejs.org and retry.
  pause
  exit /b 1
)
node bin\janus.js ui
if errorlevel 1 pause
