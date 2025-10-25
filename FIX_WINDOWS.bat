@echo off
REM Fix for Windows - Remove symlink and copy src folder to editor

echo Fixing Windows symlink issue...
echo.

cd /d %~dp0

REM Remove the symlink if it exists
if exist editor\src (
    rmdir editor\src 2>nul
    del editor\src 2>nul
)

REM Copy src folder to editor (using junction for efficiency)
echo Creating junction from editor\src to src...
mklink /J editor\src src

echo.
echo Done! The editor should work now.
echo.
echo Start the server with:
echo python -m http.server 8080
echo.
echo Then open: http://localhost:8080/editor/index.html
echo.
pause
