@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  start "" "%~dp0RegChain-AI-Dashboard.html"
  exit /b
)
node.exe "%~dp0serve-regchain.cjs" --open
if errorlevel 1 pause
