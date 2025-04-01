@echo off
setlocal

REM Stop PM2 process
call pm2 stop them-bot-dev 2>nul
call pm2 delete them-bot-dev 2>nul

REM Set environment variables
set NODE_ENV=development
set DOTENV_CONFIG_PATH=.env.development

REM Create necessary directories
if not exist "logs\development" mkdir "logs\development"
if not exist "cache\development" mkdir "cache\development"

REM Build TypeScript
echo Building TypeScript...
call npm run build

REM Check if build was successful
if errorlevel 1 (
    echo Build failed
    exit /b %errorlevel%
)

REM Set PM2 instance name
set PM2_NAME=them-bot-dev

REM Start the bot with PM2 in no-watch mode
call pm2 start ecosystem.config.cjs --only them-bot-dev --env development

REM Open logs in a new window with raw output and colors
start "Bot Logs" cmd /k "pm2 logs them-bot-dev --raw --timestamp --lines 0"

echo Development environment is running!
echo - TypeScript is watching for changes
echo - Bot logs are shown in a separate window
echo - Press Ctrl+C to stop the development environment

:loop
timeout /t 1 /nobreak > nul
goto loop 