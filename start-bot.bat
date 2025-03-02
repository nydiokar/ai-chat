@echo off
echo Cleaning up old files...
del /F /Q "logs\*.log" 2>nul
rmdir /S /Q "dist" 2>nul
rmdir /S /Q ".mcp" 2>nul

echo Building project...
call npm run build

echo Creating logs directory...
mkdir logs 2>nul

echo Starting Discord Bot...
call pm2 delete them-bot 2>nul
set NODE_OPTIONS=--no-deprecation
call pm2 start ecosystem.config.cjs

echo Bot started! Showing logs...
call pm2 logs them-bot --lines 5 --err
pause 