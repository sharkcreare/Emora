@echo off
title EmojiAssistant - Build Installer
cd /d "%~dp0"

echo ============================================
echo   EmojiAssistant Build (backend + frontend + installer)
echo ============================================

echo [1/4] Building backend...
pushd backend
call mvn -DskipTests package
if errorlevel 1 (
  echo Backend build failed!
  popd
  pause
  exit /b 1
)
popd

rem Build a minimal JRE with jlink so the installer does not require Java to be pre-installed.
echo [2/4] Building minimal JRE (jlink)...
where jlink >nul 2>&1
if errorlevel 1 (
  echo   jlink not found on PATH - skipping embedded JRE (installer will need Java).
  if not exist "backend\target\jre" mkdir "backend\target\jre"
) else (
  pushd backend
  if not exist "target\jre" (
    rem 固定模块集（已实测可运行本后端；jdeps 对 fat jar 推导不全，不采用）
    jlink --add-modules java.base,java.logging,java.xml,java.sql,java.naming,java.management,java.security.jgss,java.security.sasl,java.net.http,java.desktop,java.instrument,jdk.unsupported,jdk.crypto.ec,jdk.management,java.scripting --strip-debug --no-header-files --no-man-pages --compress zip-6 --output "target\jre"
    if errorlevel 1 (
      echo   jlink failed - falling back to empty jre dir (installer will need Java).
      if not exist "target\jre" mkdir "target\jre"
    )
  ) else (
    echo   jre already exists, skipping.
  )
  popd
)

echo [3/4] Installing frontend dependencies...
pushd frontend
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo Frontend dependency install failed!
  popd
  pause
  exit /b 1
)
popd

rem Code signing: if a self-signed cert exists (certs\emoji-assistant.pfx), sign the installer.
rem Without it the build still succeeds but Windows shows an "Unknown publisher" warning.
rem Run tools\create-signing-cert.ps1 once to generate the cert and trust it on this machine.
if exist "certs\emoji-assistant.pfx" (
  echo [4/4] Signing with self-signed certificate...
  set "CSC_LINK=%~dp0certs\emoji-assistant.pfx"
  set "CSC_KEY_PASSWORD=EmojiAssistant2026!Sign"
) else (
  echo [4/4] No signing cert found - building unsigned (SmartScreen may warn).
)

pushd frontend
call npm run dist
if errorlevel 1 (
  echo Packaging failed!
  popd
  pause
  exit /b 1
)
popd

echo.
echo Done! Installer: frontend\打包文件夹\EmojiAssistant Setup 0.1.0.exe
pause
