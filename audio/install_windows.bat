@echo off
REM Windows batch file to install audio dependencies
REM Run this from the project root directory

echo Installing audio dependencies for Windows...
echo.

REM Upgrade pip first
echo Upgrading pip...
python -m pip install --upgrade pip --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org
echo.

REM Install packages one by one
echo Installing numpy...
python -m pip install numpy>=1.24.0 --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org
echo.

echo Installing sounddevice...
python -m pip install sounddevice>=0.4.6 --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org
echo.

echo Installing aiohttp...
python -m pip install aiohttp>=3.9.0 --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org
echo.

echo Installing aiohttp-cors...
python -m pip install aiohttp-cors>=0.7.0 --trusted-host pypi.org --trusted-host pypi.python.org --trusted-host files.pythonhosted.org
echo.

echo.
echo Installation complete!
echo.
echo To start the audio server, run:
echo python -m audio.audio_server --mode mic
echo.
pause
