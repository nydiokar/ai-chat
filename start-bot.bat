@echo off
echo Building project...
call npm run build
echo Starting Discord Bot...
call pm2 start ecosystem.config.js
echo Bot started! Use "pm2 monit" to monitor, "pm2 logs" to view logs
pause 