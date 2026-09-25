@echo off
rem Sets GITBASH to Git for Windows' bash.exe. Plain "bash" in PowerShell is usually
rem WSL, which cannot see Windows PostgreSQL or this project's Python environment.
set "GITBASH="
for %%G in ("%ProgramFiles%\Git\bin\bash.exe" "%ProgramFiles(x86)%\Git\bin\bash.exe" "%LocalAppData%\Programs\Git\bin\bash.exe") do (
  if not defined GITBASH if exist "%%~G" set "GITBASH=%%~G"
)
if not defined GITBASH (
  echo Git Bash was not found. Install Git for Windows from https://git-scm.com/download/win
  exit /b 1
)
exit /b 0
