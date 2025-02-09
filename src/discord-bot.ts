import dotenv from 'dotenv';
import { DatabaseService } from './services/db-service.js';
import { DiscordService } from './services/discord-service.js';
import { defaultConfig, debug, validateEnvironment } from './utils/config.js';

dotenv.config();
validateEnvironment();

const db = DatabaseService.getInstance();

async function startDiscordBot() {
  if (!defaultConfig.discord.enabled) {
    console.error('Discord bot is not enabled in configuration');
    process.exit(1);
  }

  try {
    const discord = DiscordService.getInstance();
    // MCP initialization logging
    debug('=================================');
    debug('Initializing MCP configuration...');
    
    if (defaultConfig.discord.mcp.enabled) {
      debug(`MCP is enabled with config: ${JSON.stringify({
        authToken: defaultConfig.discord.mcp.authToken ? 'Present' : 'Missing',
        logLevel: defaultConfig.discord.mcp.logLevel
      }, null, 2)}`);
    } else {
      debug('MCP is disabled in configuration');
    }
    debug('=================================');

    await discord.start(process.env.DISCORD_TOKEN!);
    debug('=================================');
    debug('Discord bot started successfully');
    debug(`Bot name: ${discord.getClient().user?.tag}`);
    debug('=================================');
    
    // Set up session cleanup interval
    setInterval(async () => {
      try {
        await db.cleanInactiveSessions(defaultConfig.discord.sessionTimeout);
      } catch (error) {
        console.error('Error cleaning inactive sessions:', error);
      }
    }, defaultConfig.discord.cleanupInterval * 60 * 60 * 1000);
  } catch (error) {
    console.error('Failed to start Discord bot:', error);
    process.exit(1);
  }
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  debug('\nGracefully shutting down...');
  await DiscordService.getInstance().stop();
  await db.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  debug('\nGracefully shutting down...');
  await DiscordService.getInstance().stop();
  await db.disconnect();
  process.exit(0);
});

// Start the bot
startDiscordBot();
