#!/bin/bash

echo "Stopping any existing dev instances..."
pm2 stop them-bot-dev 2>/dev/null
pm2 delete them-bot-dev 2>/dev/null
pkill -f "them-bot-dev"

echo "Setting up directories..."
mkdir -p logs/development
mkdir -p cache

echo "Building project..."
npm run build

# Start TypeScript compiler in watch mode (in background)
echo "Starting TypeScript compiler in watch mode..."
npm run build:watch &

echo "Starting Discord Bot (Development)..."
export NODE_ENV=development
export NODE_OPTIONS="--no-deprecation"
export PM2_NAME="them-bot-dev"

# Start the bot with PM2 in no-watch mode
pm2 start ecosystem.config.cjs --only them-bot-dev --env development

# Show logs with more lines and raw output
pm2 logs them-bot-dev --raw --lines 200 --timestamp

echo "Development environment is running!"
echo "- TypeScript is watching for changes"
echo "- Bot logs are being shown"
echo "- Press Ctrl+C to stop the development environment"

# Wait indefinitely
while true; do
    sleep 1
done 