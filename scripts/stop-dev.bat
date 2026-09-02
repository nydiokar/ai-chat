@echo off
echo Stopping Development Bot...

REM Stop PM2 process
call pm2 stop them-bot-dev 2>nul
call pm2 delete them-bot-dev 2>nul

REM Force kill any remaining node processes
taskkill /F /IM node.exe /FI "WINDOWTITLE eq them-bot-dev*" 2>nul
taskkill /F /IM node.exe /FI "WINDOWTITLE eq TypeScript Watch*" 2>nul

echo Development bot stopped!
pause 