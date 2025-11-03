@echo off
REM Rhizomium Server Startup Script (Windows)

echo.
echo Starting Rhizomium Server...
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo Python not found. Please install Python 3.8 or higher.
    pause
    exit /b 1
)

REM Check if dependencies are installed
echo Checking dependencies...
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo Installing dependencies...
    pip install -r requirements.txt
)

REM Start the server
echo.
echo Starting server on http://127.0.0.1:5000
echo.
python rhizo_server.py

pause
