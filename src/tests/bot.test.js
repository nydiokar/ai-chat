import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
describe('Discord Bot Tests', () => {
    let client;
    before(async () => {
        dotenv.config();
        client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ]
        });
    });
    it('should connect to Discord', async () => {
        const token = process.env.DISCORD_TOKEN;
        expect(token).to.not.be.undefined;
        await client.login(token);
        expect(client.user).to.not.be.null;
    });
    after(async () => {
        await client.destroy();
    });
});
