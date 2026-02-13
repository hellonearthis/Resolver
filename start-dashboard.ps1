# Resolve Tools Dashboard Launcher (Electron)
$Host.UI.RawUI.WindowTitle = "Resolve Tools Dashboard"

Write-Host "Starting Resolve Tools Dashboard (Electron)..." -ForegroundColor Cyan
Write-Host ""

# Navigate to script directory
Set-Location $PSScriptRoot

# Start the Electron app in dev mode
# This compiles Electron TS, starts Vite, and launches the Electron window
Write-Host "Compiling Electron and starting Vite..." -ForegroundColor Yellow
npm start
Write-Host ""
Write-Host "Dashboard closed."

