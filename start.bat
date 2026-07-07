@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Gesture Note Synth - Launcher
echo ============================================

where npm >nul 2>nul
if errorlevel 1 (
    echo.
    echo ERROR: Node.js/npm was not found on this computer.
    echo Please install Node.js from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo.
    echo First-time setup: installing dependencies, this may take a minute...
    call npm install
    if errorlevel 1 (
        echo.
        echo npm install failed. See the errors above.
        pause
        exit /b 1
    )
)

echo.
echo Starting the dev server and opening your browser...
echo Press Ctrl+C in this window to stop the server.
echo.

call npm run dev -- --open

pause
