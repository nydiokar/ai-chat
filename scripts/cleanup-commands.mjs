import { REST, Routes } from 'discord.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Setup ES module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use the same environment loading logic as the main bot
const envPath = process.env.DOTENV_CONFIG_PATH || (process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development');
console.log(`Loading environment from: ${envPath}`);

// Load environment variables
const result = dotenv.config({ path: join(__dirname, '..', envPath) });
if (result.error) {
    console.error(`Error loading environment from ${envPath}:`, result.error);
    process.exit(1);
}

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
    console.error('Missing required environment variables!');
    console.error(`Please make sure you have these in your ${envPath} file:`);
    console.error('- DISCORD_TOKEN');
    console.error('- DISCORD_CLIENT_ID');
    console.error('- DISCORD_GUILD_ID');
    console.error('\nCurrent environment:', process.env.NODE_ENV || 'development');
    process.exit(1);
}

const rest = new REST().setToken(token);

async function cleanupCommands() {
    try {
        console.log(`Using ${process.env.NODE_ENV || 'development'} environment configuration...`);
        console.log('Fetching existing commands...');
        const commands = await rest.get(
            Routes.applicationGuildCommands(clientId, guildId)
        );

        if (!Array.isArray(commands)) {
            console.error('Unexpected response format from Discord API');
            return;
        }

        console.log(`Found ${commands.length} commands. Cleaning up...`);
        
        if (commands.length === 0) {
            console.log('No commands to clean up!');
            return;
        }
        
        // Delete each command
        for (const command of commands) {
            try {
                await rest.delete(
                    Routes.applicationGuildCommand(clientId, guildId, command.id)
                );
                console.log(`Deleted command: ${command.name}`);
            } catch (err) {
                console.error(`Failed to delete command ${command.name}:`, err.message);
            }
        }

        console.log('All commands cleaned up successfully!');
    } catch (error) {
        console.error('Error cleaning up commands:', error.message);
        if (error.code === 50001) {
            console.error('Bot lacks permissions. Make sure it has the "applications.commands" scope!');
        }
    }
}

cleanupCommands(); 