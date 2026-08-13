@echo off
title EmojiAssistant - Launcher
cd /d "%~dp0"

echo ============================================
echo   EmojiAssistant Launcher
echo ============================================
echo.

rem 1. Detect an already-running instance before starting a second one.
rem    a) Dev panel: Vite dev server responds on localhost:5173
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing 'http://localhost:5173' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo EmojiAssistant dev panel is already running.
  echo Press Ctrl+Shift+E to show the panel, or click the tray icon.
  pause >nul
  exit /b 0
)

rem    b) Installed app: EmojiAssistant.exe process owns backend port 18080.
rem       Starting the dev version too would make both fight over 18080.
powershell -NoProfile -Command "if (Get-Process -Name EmojiAssistant -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo The installed EmojiAssistant is already running.
  echo Starting the dev version now would conflict on backend port 18080.
  echo Press Ctrl+Shift+E to show the installed app, or click its tray icon.
  pause >nul
  exit /b 0
)

rem 2. Frontend dependencies
if not exist "frontend\node_modules" (
  echo [1/3] Installing frontend dependencies, please wait...
  pushd frontend
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Failed to install frontend dependencies. Check your network and retry.
    popd
    pause
    exit /b 1
  )
  popd
) else (
  echo [1/3] Frontend dependencies ready
)

rem 3. Backend jar (the app starts the backend itself; only build when missing)
dir /b "backend\target\*.jar" >nul 2>&1
if errorlevel 1 (
  echo [2/3] First run: building backend jar, about 1-2 minutes...
  pushd backend
  call mvn -q -DskipTests package
  if errorlevel 1 (
    echo Backend build failed. Make sure JDK 17+ and Maven are installed and on PATH.
    popd
    pause
    exit /b 1
  )
  popd
) else (
  echo [2/3] Backend jar ready
)

rem 4. Start the panel (npm run dev auto-starts the backend)
echo [3/3] Starting panel...
start "EmojiAssistant-Dev" /d "%~dp0frontend" cmd /k "npm run dev"

echo.
echo The panel will pop up automatically. Press Ctrl+Shift+E anytime to toggle.
echo Close the black window to exit. Press any key to close this window...
pause >nul
