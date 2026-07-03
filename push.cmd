@echo off
setlocal
REM House Hunt — same as deploy.cmd (PR ship workflow; no direct push to main)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1" %*
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
