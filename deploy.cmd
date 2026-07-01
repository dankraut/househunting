@echo off
setlocal
REM House Hunt — one-command deploy (commit, sync, merge to main, push)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1" %*
set EXITCODE=%ERRORLEVEL%
endlocal & exit /b %EXITCODE%
