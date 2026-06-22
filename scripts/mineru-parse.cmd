@echo off
set "SCRIPT=%~dp0mineru_precise_parse.py"

where uv >nul 2>nul
if %ERRORLEVEL%==0 (
  uv run --python 3.12 python "%SCRIPT%" %*
  exit /b %ERRORLEVEL%
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 "%SCRIPT%" %*
  exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python "%SCRIPT%" %*
  exit /b %ERRORLEVEL%
)

echo No Python runtime was found. Install uv, Python Launcher for Windows, or Python 3, then run this wrapper again. 1>&2
exit /b 2
