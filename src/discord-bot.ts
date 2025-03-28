import dotenv from 'dotenv';

// Load environment variables based on DOTENV_CONFIG_PATH or NODE_ENV
const envPath = process.env.DOTENV_CONFIG_PATH || (process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development');
const instanceId = process.env.INSTANCE_ID || process.env.NODE_ENV || 'development';

console.log(`Starting bot instance: ${instanceId}`);
console.log(`Loading environment from: ${envPath}`);
console.log(`Environment: ${process.env.NODE_ENV}`);

const result = dotenv.config({ path: envPath });
if (result.error) {
    console.error(`Error loading environment from ${envPath}:`, result.error);
    process.exit(1);
}

// Now import the rest
import { DatabaseService } from './services/db-service.js';
import { DiscordService } from './services/discord-service.js';
import { defaultConfig, debug, validateEnvironment } from './utils/config.js';

async function main() {
  try {
    // Validate environment before proceeding
    validateEnvironment();
    
    const db = DatabaseService.getInstance();
    
    console.log(`Starting Discord bot (${instanceId})...`);
    await DiscordService.getInstance();
    console.log('Bot initialization complete');

    // Signal PM2 that we're ready
    if (process.send) {
      process.send('ready');
    }

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
