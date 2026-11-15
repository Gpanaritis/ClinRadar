@echo off
setlocal
rem ClinRadar with its launch page and named sign-in (password mode) at http://127.0.0.1:4173/site/
where node.exe >nul 2>nul
if errorlevel 1 (
  echo ClinRadar needs Node.js 22.13 or later. Install it from https://nodejs.org, then open this file again.
  pause
  exit /b 1
)
set "NEED_INSTALL="
if not exist "%~dp0node_modules\@anthropic-ai\sdk\package.json" set "NEED_INSTALL=1"
if not exist "%~dp0node_modules\@modelcontextprotocol\sdk\package.json" set "NEED_INSTALL=1"
if defined NEED_INSTALL (
  where npm.cmd >nul 2>nul
  if not errorlevel 1 (
    echo Installing the AI step and the agents. This happens once.
    pushd "%~dp0"
    call npm.cmd install --no-audit --no-fund
    popd
  )
)
rem Named users sign in. Plain HTTP is fine on this computer: the session cookie gets the Secure flag only behind HTTPS.
set "REGCHAIN_AUTH=password"
set "REGCHAIN_HOST=127.0.0.1"
set "REGCHAIN_PORT=4173"
set "REGCHAIN_PUBLIC_ORIGIN="
rem The four demo accounts (one per role). New passwords are printed once and kept in .regchain-data\demo-accounts.txt.
node.exe "%~dp0scripts\demo-accounts.mjs"
if errorlevel 1 (
  pause
  exit /b 1
)
node.exe "%~dp0serve-regchain.cjs" --open-site
if errorlevel 1 pause
