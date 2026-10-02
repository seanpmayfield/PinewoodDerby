@echo off
rem Starts the Pinewood Derby race server and opens the home page.
rem An installed copy has its own Node.js in the runtime folder and keeps the
rem race data under ProgramData. A git checkout uses whatever Node 22+ is on
rem the PATH; its first run installs dependencies and builds the screens.
cd /d "%~dp0"
if not defined DERBY_PORT set DERBY_PORT=8080

if exist "%~dp0runtime\node.exe" (
  if not defined DERBY_DATA_DIR set "DERBY_DATA_DIR=%ProgramData%\Pinewood Derby"
  start "" "http://localhost:%DERBY_PORT%"
  echo.
  echo Race server running. Close this window to stop it.
  echo.
  "%~dp0runtime\node.exe" "%~dp0packages\server\dist\index.js"
  pause
  exit /b
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

if not exist packages\web\dist\index.html (
  echo Building the screens...
  call npm run build
  if errorlevel 1 ( pause & exit /b 1 )
)

start "" "http://localhost:%DERBY_PORT%"
echo.
echo Race server running. Close this window to stop it.
echo.
call npm run start -w @derby/server
pause
