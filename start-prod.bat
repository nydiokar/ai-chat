@echo off
setlocal

echo Stopping any existing production instances...
call pm2 stop them-bot 2>nul
call pm2 delete them-bot 2>nul
taskkill /F /IM node.exe /FI "WINDOWTITLE eq them-bot*" 2>nul

echo Setting up directories...
mkdir logs 2>nul
mkdir logs\production 2>nul
mkdir cache 2>nul

echo Ensuring we're on main branch...
git fetch
git checkout main

echo Building project...
call npm run build

echo Starting Discord Bot (Production)...
set NODE_OPTIONS=--no-deprecation
set NODE_ENV=production
set PM2_NAME=them-bot
call pm2 start ecosystem.config.cjs --only them-bot --env production

echo Bot started! Showing logs...
call pm2 logs them-bot
pause 