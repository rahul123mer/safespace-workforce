@echo off
rem Windows (PowerShell / cmd): stops the app started by start.cmd and the local database.
setlocal
call "%~dp0.gitbash.cmd" || exit /b 1
set "HERE=%~dp0"
set "HERE=%HERE:\=/%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0.stop-app.ps1"
"%GITBASH%" "%HERE%dev-db.sh" stop
