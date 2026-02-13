@echo off
title Resolve Tools Dashboard
echo Starting Resolve Tools Dashboard (Electron)...
echo.

cd /d "%~dp0"

:: Start the Electron app in dev mode
:: This compiles Electron TS, starts Vite, and launches Electron
npm start

echo.
echo Dashboard closed.
pause
