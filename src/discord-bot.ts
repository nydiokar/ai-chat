import dotenv from 'dotenv';
import { DatabaseService } from './services/db-service.js';
import { DiscordService } from './services/discord-service.js';
import { defaultConfig, debug, validateEnvironment } from './utils/config.js';

dotenv.config();
validateEnvironment();

const db = DatabaseService.getInstance();

async function main() {
  try {
    console.log('Starting Discord bot...');
    await DiscordService.getInstance();
    console.log('Bot initialization complete');

    // Handle shutdown signals
    process.on('SIGINT', async () => {
      console.log('Received SIGINT. Shutting down...');
      await DiscordService.getInstance().then(service => service.stop());
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Received SIGTERM. Shutting down...');
      await DiscordService.getInstance().then(service => service.stop());
      process.exit(0);
    });

    // Set up session cleanup interval
    setInterval(async () => {
      try {
        await db.cleanInactiveSessions(defaultConfig.discord.sessionTimeout);
      } catch (error) {
        console.error('Error cleaning inactive sessions:', error);
      }
    }, defaultConfig.discord.cleanupInterval * 60 * 60 * 1000);
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();
