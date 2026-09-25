@echo off
rem Windows (PowerShell / cmd): starts the local database, then everything in start.sh.
rem   .\start.cmd                 development
rem   .\start.cmd --no-worker     any start.sh option is passed through
rem Ctrl+C stops the app; the database keeps running until .\stop.cmd.
setlocal
call "%~dp0.gitbash.cmd" || exit /b 1
set "HERE=%~dp0"
set "HERE=%HERE:\=/%"
"%GITBASH%" "%HERE%dev-db.sh" start || exit /b 1
"%GITBASH%" "%HERE%start.sh" %*
