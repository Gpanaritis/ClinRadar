@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  start "" "%~dp0RegChain-AI-Dashboard.html"
  exit /b
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
node.exe "%~dp0serve-regchain.cjs" --open
if errorlevel 1 pause
