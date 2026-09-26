@echo off
rem Windows launcher for read.py. Prefers the py launcher, falls back to python.
setlocal
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 "%~dp0read.py" %*
) else (
  python "%~dp0read.py" %*
)
exit /b %ERRORLEVEL%
