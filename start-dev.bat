@echo off
setlocal

echo Stopping any existing dev instances...
call pm2 stop them-bot-dev 2>nul
call pm2 delete them-bot-dev 2>nul
taskkill /F /IM node.exe /FI "WINDOWTITLE eq them-bot-dev*" 2>nul

echo Setting up directories...
mkdir logs 2>nul
mkdir logs\development 2>nul
mkdir cache 2>nul

echo Building project...
call npm run build

REM Start TypeScript compiler in watch mode (in background)
echo Starting TypeScript compiler in watch mode...
start "TypeScript Watch" cmd /c "npm run build:watch"

echo Starting Discord Bot (Development)...
SET NODE_ENV=development
set NODE_OPTIONS=--no-deprecation
set PM2_NAME=them-bot-dev

REM Start the bot with PM2 in no-watch mode
call pm2 start ecosystem.config.cjs --only them-bot-dev --env development

REM Show logs in a separate window with more lines and raw output
start "Bot Logs" cmd /c "pm2 logs them-bot-dev --raw --lines 200 --timestamp"

echo Development environment is running!
echo - TypeScript is watching for changes
echo - Bot logs are shown in a separate window
echo - Press Ctrl+C to stop the development environment

:loop
timeout /t 1 /nobreak > nul
goto loop 