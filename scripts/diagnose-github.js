#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
/**
 * GitHub Tool Diagnostic Runner
 * 
 * This script executes the GitHub diagnostic tool to troubleshoot GitHub integration issues.
 */

console.log('\n====== GitHub Tool Diagnostic ======\n');
console.log('Initializing diagnostic tool...\n');

// Get current file path and directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine path to the diagnostic script
const scriptPath = path.join(__dirname, '..', 'src', 'tools', 'diagnostic', 'github-tool-tester.ts');

// Execute the diagnostic script with full logging
const diagnosticProcess = spawn('npx', [
    'cross-env',
    'NODE_OPTIONS="--loader ts-node/esm"',
    'ts-node',
    scriptPath
], {
    stdio: 'inherit',
    shell: true
});

// Handle process events
diagnosticProcess.on('error', (err) => {
    console.error(`Failed to start diagnostic: ${err.message}`);
    process.exit(1);
});

diagnosticProcess.on('close', (code) => {
    if (code === 0) {
        console.log('\n✅ GitHub diagnostic completed successfully');
    } else {
        console.error(`\n❌ GitHub diagnostic failed with code ${code}`);
    }
}); 