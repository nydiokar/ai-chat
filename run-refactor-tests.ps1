# PowerShell script to run refactored component tests

Write-Host "=======================================================" -ForegroundColor Blue
Write-Host "Running tests for refactored ReAct components" -ForegroundColor Blue
Write-Host "=======================================================" -ForegroundColor Blue

# Set error behavior
$ErrorActionPreference = "Stop"

try {
    Write-Host "Running tests..." -ForegroundColor Blue
    npm run test:agent-runtime
    
    Write-Host "All tests passed!" -ForegroundColor Green
    Write-Host "=======================================================" -ForegroundColor Blue
} catch {
    Write-Host "Tests failed with error: $_" -ForegroundColor Red
    exit 1
} 
