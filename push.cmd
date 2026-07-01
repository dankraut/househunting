@echo off
setlocal
REM House Hunt — push main to GitHub (commit if needed). Cloudflare Pages auto-deploys.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\push.ps1" %*
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
