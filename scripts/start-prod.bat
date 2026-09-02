@echo off
setlocal

REM Stop PM2 process
call pm2 stop them-bot 2>nul
call pm2 delete them-bot 2>nul

REM Set environment variables
set NODE_ENV=production
set DOTENV_CONFIG_PATH=.env.production

REM Create necessary directories
if not exist "logs\production" mkdir "logs\production"
if not exist "cache\production" mkdir "cache\production"

REM Build TypeScript
echo Building TypeScript...
call npm run build

REM Check if build was successful
if errorlevel 1 (
    echo Build failed
    exit /b %errorlevel%
)

REM Set PM2 instance name
set PM2_NAME=them-bot

REM Start the bot with PM2
call pm2 start ecosystem.config.cjs --only them-bot --env production

REM Open logs in a new window with raw output and colors
start "Bot Logs" cmd /k "pm2 logs them-bot --raw --timestamp --lines 0" 