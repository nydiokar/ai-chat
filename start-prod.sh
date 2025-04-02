#!/bin/bash

# Stop PM2 process
command pm2 stop them-bot 2>/dev/null
command pm2 delete them-bot 2>/dev/null

# Set environment variables
export NODE_ENV=production
export DOTENV_CONFIG_PATH=.env.production

# Create necessary directories
mkdir -p logs/production
mkdir -p cache/production

# Build TypeScript
echo "Building TypeScript..."
command npm run build

# Check if build was successful
if [ $? -ne 0 ]; then
    echo "Build failed"
    exit 1
fi

# Set PM2 instance name
export PM2_NAME=them-bot

# Start the bot with PM2
command pm2 start ecosystem.config.cjs --only them-bot --env production

# Open logs in a new terminal
gnome-terminal -- pm2 logs them-bot --raw --timestamp --lines 0 || \
xterm -e "pm2 logs them-bot --raw --timestamp --lines 0" || \
konsole -e "pm2 logs them-bot --raw --timestamp --lines 0" || \
pm2 logs them-bot --raw --timestamp --lines 0 