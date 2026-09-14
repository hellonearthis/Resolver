@echo off
setlocal enabledelayedexpansion

echo =======================================================
echo          Resolver - llama-server 1-Click Launcher
echo =======================================================
echo.

:: WHAT: Check if llama-server.exe is accessible in PATH or in common install directories.
:: WHY: Ensures users with different llama.cpp setups can launch without manual PATH configuration.
set "LLAMA_BIN="

where llama-server.exe >nul 2>&1
if !errorlevel! equ 0 (
    set "LLAMA_BIN=llama-server.exe"
) else if exist "C:\llamaCPP\llama-server.exe" (
    set "LLAMA_BIN=C:\llamaCPP\llama-server.exe"
) else if exist "%USERPROFILE%\llama.cpp\build\bin\Release\llama-server.exe" (
    set "LLAMA_BIN=%USERPROFILE%\llama.cpp\build\bin\Release\llama-server.exe"
) else (
    echo [ERROR] Could not find llama-server.exe.
    echo Please install llama.cpp into C:\llamaCPP or add llama-server.exe to your PATH.
    pause
    exit /b 1
)

:: Server configuration
set "PORT=8080"
set "HOST=127.0.0.1"
set "CTX_SIZE=8192"
set "N_GPU_LAYERS=99"

echo [*] Using binary: !LLAMA_BIN!
echo [*] Hosting on:   http://!HOST!:!PORT!
echo [*] Context size: !CTX_SIZE!
echo [*] GPU Layers:   !N_GPU_LAYERS!
echo.

:: WHAT: Check if an instance is already listening on port 8080.
:: WHY: Prevents confusing crash errors when an existing llama-server is already running.
netstat -ano | findstr ":!PORT! " | findstr "LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
    echo [INFO] A server is already running on port !PORT!.
    echo You can connect to it directly in Resolver Settings or use Switch Model.
    echo To restart, close the running server first.
    echo.
    pause
    exit /b 0
)
echo [*] To specify a model, drag and drop a .gguf file onto this .bat script,
echo     or set the MODEL_PATH environment variable before launching.
echo.

set "MODEL_ARG="
if not "%~1"=="" (
    set "MODEL_ARG=-m "%~1""
) else if not "%MODEL_PATH%"=="" (
    set "MODEL_ARG=-m "%MODEL_PATH%""
)

if "!MODEL_ARG!"=="" (
    echo [INFO] No model file passed. Launching llama-server with default configuration...
)

echo [*] Starting llama-server...
"!LLAMA_BIN!" !MODEL_ARG! --host !HOST! --port !PORT! -c !CTX_SIZE! -ngl !N_GPU_LAYERS! --flash-attn on --alias default

pause
