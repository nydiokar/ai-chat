import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const token = process.env.DISCORD_TOKEN;
console.log('Token length:', token?.length); // Don't log the full token!

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

client.once('ready', () => {
  console.log('Bot is ready!');
  console.log(`Logged in as ${client.user?.tag}`);
});

client.login(token).then(() => {
  console.log('Login successful');
}).catch((error) => {
  console.error('Login failed:', error);
}); 