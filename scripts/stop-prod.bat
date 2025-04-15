@echo off
echo Stopping Production Bot...

REM Stop PM2 process
call pm2 stop them-bot 2>nul
call pm2 delete them-bot 2>nul

REM Force kill any remaining node processes
taskkill /F /IM node.exe /FI "WINDOWTITLE eq them-bot*" 2>nul

echo Production bot stopped!
pause 