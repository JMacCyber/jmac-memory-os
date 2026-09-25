@echo off
rem Windows launcher for memos-init. Prefers the py launcher, falls back to python.
setlocal
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 "%~dp0memos-init" %*
) else (
  python "%~dp0memos-init" %*
)
exit /b %ERRORLEVEL%
