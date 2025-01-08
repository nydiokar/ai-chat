@echo off
echo Stopping Them Bot...
call pm2 stop them-bot
call pm2 delete them-bot
echo Bot stopped!
pause 