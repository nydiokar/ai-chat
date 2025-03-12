@echo off
echo Stopping Them Bot...

REM Stop PM2 processes
call pm2 stop them-bot
call pm2 delete them-bot

REM Force kill any remaining node processes with the bot's title
taskkill /F /IM node.exe /FI "WINDOWTITLE eq them-bot*" 2>nul

REM Clean up MCP directory
rmdir /S /Q ".mcp" 2>nul

echo Bot stopped!
pause 