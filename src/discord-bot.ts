import dotenv from 'dotenv';
import { info, error } from './utils/logger.js';
import { createLogContext, createErrorContext } from './utils/log-utils.js';

const COMPONENT = 'DiscordBot';

// Load environment variables based on DOTENV_CONFIG_PATH or NODE_ENV
const envPath = process.env.DOTENV_CONFIG_PATH || (process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development');
const instanceId = process.env.INSTANCE_ID || process.env.NODE_ENV || 'development';

// Create base context for startup
const startupContext = createLogContext(COMPONENT, 'startup', { instanceId });

info('Starting bot instance', {
  ...startupContext,
  envPath,
  environment: process.env.NODE_ENV
});

const result = dotenv.config({ path: envPath });
if (result.error) {
  error('Failed to load environment', createErrorContext(
    COMPONENT,
    'startup',
    'System',
    'ENV_LOAD_ERROR',
    result.error,
    { envPath }
  ));
  process.exit(1);
}

// Now import the rest
import { DatabaseService } from './services/db-service.js';
import { DiscordService } from './services/discord-service.js';
import { defaultConfig, validateEnvironment } from './utils/config.js';

export async function startBot(instanceId: string, envPath: string) {
  const context = createLogContext(COMPONENT, 'startBot', { instanceId });
  
  try {
    // Validate environment before proceeding
    validateEnvironment();
    
    const db = DatabaseService.getInstance();
    
    info('Initializing Discord bot', context);
    await DiscordService.getInstance();
    info('Bot initialization complete', context);

    // Signal PM2 that we're ready
    if (process.send) {
      process.send('ready');
      info('Signaled ready state to PM2', context);
    }

    // Handle shutdown signals
    process.on('SIGINT', () => {
      info('Received SIGINT signal', context);
      cleanup();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      info('Received SIGTERM signal', context);
      cleanup();
      process.exit(0);
    });

    // Set up session cleanup interval
    const cleanupInterval = defaultConfig.discord.cleanupInterval * 60 * 60 * 1000;
    info('Setting up session cleanup', {
      ...context,
      intervalMs: cleanupInterval,
      timeoutMs: defaultConfig.discord.sessionTimeout
    });

    setInterval(async () => {
      const cleanupContext = createLogContext(COMPONENT, 'cleanupSession');
      try {
        await db.cleanInactiveSessions(defaultConfig.discord.sessionTimeout);
        info('Cleaned inactive sessions', cleanupContext);
      } catch (err) {
        error('Failed to clean inactive sessions', createErrorContext(
          COMPONENT,
          'cleanupSession',
          'System',
          'CLEANUP_ERROR',
          err
        ));
      }
    }, cleanupInterval);

  } catch (err) {
    error('Failed to start bot', createErrorContext(
      COMPONENT,
      'startBot',
      'System',
      'STARTUP_ERROR',
      err,
      { instanceId }
    ));
    process.exit(1);
  }
}

function cleanup() {
  const context = createLogContext(COMPONENT, 'cleanup');
  
  try {
    info('Starting cleanup process', context);
    // ... existing cleanup code ...
    info('Cleanup complete', context);
  } catch (err) {
    error('Cleanup failed', createErrorContext(
      COMPONENT,
      'cleanup',
      'System',
      'CLEANUP_ERROR',
      err
    ));
  }
}

startBot(instanceId, envPath);
