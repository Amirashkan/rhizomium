@echo off
REM Get the latest work onto the develop branch (Windows)
REM
REM develop is where every Claude Code session lands its work; main only moves
REM on a release. Double-click this file, or run it from cmd, and you are on
REM the newest develop -- no branch name to look up, ever.

setlocal enabledelayedexpansion

echo.
echo Fetching from origin...
git fetch origin --prune
if errorlevel 1 (
    echo.
    echo Could not reach origin. Check your connection and try again.
    pause
    exit /b 1
)

REM Refuse to touch a dirty working tree: switching branches would either drag
REM your uncommitted edits onto develop or fail halfway through.
git diff --quiet
if errorlevel 1 goto dirty
git diff --cached --quiet
if errorlevel 1 goto dirty

REM Remember where develop was, so we can list what arrived.
set OLD=
for /f %%i in ('git rev-parse --verify --quiet refs/heads/develop') do set OLD=%%i

if "%OLD%"=="" (
    echo Creating a local develop branch that follows origin/develop...
    git checkout -b develop origin/develop
    if errorlevel 1 goto nodevelop
) else (
    git checkout develop
    if errorlevel 1 goto failed
    REM Fast-forward only. If develop has diverged, something is wrong and you
    REM should look at it rather than have a script invent a merge.
    git merge --ff-only origin/develop
    if errorlevel 1 goto diverged
)

echo.
if "%OLD%"=="" (
    echo On develop, up to date.
) else (
    for /f %%c in ('git rev-list --count %OLD%..HEAD') do set COUNT=%%c
    if "!COUNT!"=="0" (
        echo Already up to date -- nothing new on develop.
    ) else (
        echo !COUNT! new commit^(s^) on develop:
        echo.
        git --no-pager log --oneline %OLD%..HEAD
        echo.
        REM Dependencies only need reinstalling when the lockfile actually moved.
        git diff --name-only %OLD%..HEAD | findstr /x "package-lock.json" >nul
        if not errorlevel 1 (
            echo package-lock.json changed -- running npm install...
            call npm install
        )
    )
)

echo.
echo Ready. Start the editor with:  npm run dev
echo.
pause
exit /b 0

:dirty
echo.
echo You have uncommitted changes. Commit or stash them first:
echo.
git --no-pager status --short
echo.
echo     git stash          (set them aside^)
echo     git stash pop      (bring them back afterwards^)
echo.
pause
exit /b 1

:diverged
echo.
echo Your local develop has commits that origin/develop does not, so it cannot
echo fast-forward. Nothing has been changed. Look at what you have:
echo.
git --no-pager log --oneline origin/develop..develop
echo.
pause
exit /b 1

:nodevelop
echo.
echo There is no develop branch on origin yet. Ask Claude to create it, or:
echo.
echo     git checkout -b develop origin/main
echo     git push -u origin develop
echo.
pause
exit /b 1

:failed
echo.
echo Could not switch to develop. Nothing has been changed.
echo.
pause
exit /b 1
