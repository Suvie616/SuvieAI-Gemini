@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title SUUWETHAAN AI
echo.
echo ================================================
echo   SUUWETHAAN AI - setup and launch
echo ================================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Python was not found.
    echo Install Python 3.10+ from https://www.python.org/downloads/
    echo IMPORTANT: check "Add python.exe to PATH" during install.
    echo.
    pause
    exit /b 1
  )
  set "PY=py -3"
) else (
  set "PY=python"
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating virtual environment...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Could not create .venv
    pause
    exit /b 1
  )
) else (
  echo [1/3] Virtual environment already exists.
)

echo [2/3] Installing dependencies...
".venv\Scripts\python.exe" -m pip install --upgrade pip >nul 2>nul
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] pip install failed.
  pause
  exit /b 1
)

if not exist ".env" (
  if exist ".env.example" (
    echo [info] Creating .env from .env.example — add your API key inside.
    copy /Y ".env.example" ".env" >nul
  ) else (
    echo [ERROR] Missing .env file. Create one with API_KEY=...
    pause
    exit /b 1
  )
)

echo [3/3] Starting SUUWETHAAN AI...
echo.
".venv\Scripts\python.exe" app.py
echo.
echo Server stopped.
pause
