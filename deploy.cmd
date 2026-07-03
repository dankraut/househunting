@echo off
setlocal
REM House Hunt — ship via PR (cursor/* branch → auto-merge → Cloudflare Pages)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1" %*
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
