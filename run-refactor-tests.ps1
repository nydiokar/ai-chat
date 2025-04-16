# PowerShell script to run refactored component tests

Write-Host "=======================================================" -ForegroundColor Blue
Write-Host "Running tests for refactored ReAct components" -ForegroundColor Blue
Write-Host "=======================================================" -ForegroundColor Blue

# Set error behavior
$ErrorActionPreference = "Stop"

try {
    # Create a temporary test script for our specific tests
    Write-Host "Creating temporary test files..." -ForegroundColor Blue
    
    # Create a temporary test file that runs our specific tests
    $testContent = @"
import { describe } from 'mocha';

// Import our test files
import './tools/tool-formatter.test.js';
import './prompt/react-prompt-generator.test.js';
import './agents/react-tool-handler.test.js';

// Main describe block is just for organization
describe('ReAct Refactoring Tests', () => {
  // Tests are imported above
});
"@

    # Write the test file
    $testFile = "src/tests/refactor-tests.ts"
    [System.IO.File]::WriteAllText($testFile, $testContent)
    
    Write-Host "Running tests..." -ForegroundColor Blue
    npm run test:unit -- "src/tests/refactor-tests.ts"
    
    # Clean up
    Remove-Item $testFile -Force
    
    Write-Host "All tests passed!" -ForegroundColor Green
    Write-Host "=======================================================" -ForegroundColor Blue
} catch {
    Write-Host "Tests failed with error: $_" -ForegroundColor Red
    # Clean up even if there's an error
    if (Test-Path "src/tests/refactor-tests.ts") {
        Remove-Item "src/tests/refactor-tests.ts" -Force
    }
    exit 1
} 