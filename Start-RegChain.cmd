@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  start "" "%~dp0RegChain-AI-Dashboard.html"
  exit /b
)
if not exist "%~dp0node_modules\@anthropic-ai\sdk\package.json" (
  where npm.cmd >nul 2>nul
  if not errorlevel 1 (
    echo Installing the AI step. This happens once.
    pushd "%~dp0"
    call npm.cmd install --no-audit --no-fund
    popd
  )
)
node.exe "%~dp0serve-regchain.cjs" --open
if errorlevel 1 pause
