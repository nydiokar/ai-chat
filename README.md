# Them - AI Chat CLI & Discord Bot

A versatile tool for chatting with GPT and Claude AI models through both CLI and Discord, with local conversation storage.

## Features

- Multi-interface Support:
  - Command-line interface for direct chat
  - Discord bot for team collaboration
- AI Integration:
- Chat with OpenAI's GPT, Anthropic's Claude, DeepSeek, or local Ollama models
  - Smart context management
  - Automatic retry on API rate limits
- Conversation Management:
  - Local storage using SQLite
  - List, show, continue, and delete conversations
- User Experience:
  - Input validation and error handling
  - Debug mode for troubleshooting
  - Configurable settings 
  
# **Configure MCP servers in src\tools\mcp\mcp_config.ts**

## Prerequisites

- Node.js (v16 or higher)
- npm
- OpenAI API key (for GPT)
- Anthropic API key (for Claude)
- DeepSeek API key (for DeepSeek)
- Ollama (for local model inference)

## Installation

1. Clone the repository:
```bash
git clone [repository-url]
cd them
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with your API keys:
```env
# Model Selection
MODEL=gpt  # Options: gpt, claude, deepseek, ollama

# Required API Keys (add the ones you plan to use)
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
DEEPSEEK_API_KEY=your_deepseek_key_here

# Ollama Configuration (if using Ollama)
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2.latest  # or any other installed model that has tool usage

# Debug Mode (Optional)
DEBUG=true

# Discord Configuration (Optional)
DISCORD_ENABLED=true
DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
```

### Discord Bot Setup (Optional)

1. Create a new Discord application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a bot for your application and copy the bot token
3. Add the bot token to your `.env` file as `DISCORD_TOKEN`
4. Enable the following bot intents in the Discord Developer Portal:
   - Server Members Intent
   - Message Content Intent
   - Presence Intent
5. Use the OAuth2 URL Generator to create an invite link with these permissions:
   - Send Messages
   - Read Messages/View Channels
   - Read Message History

4. Initialize the database:
```bash
npm run db:init
```

5. Build the project:
```bash
npm run build
```

6. Link the CLI globally (optional):
```bash
npm link
```

## Usage

### Discord Bot

#### Starting the Bot
1. Using PM2 (Recommended for 24/7 operation):
```bash
# Install PM2 globally
npm install -g pm2

# Build the project
npm run build

# Start the bot with PM2
pm2 start ecosystem.config.js

# Monitor the bot
pm2 monit

# View logs
pm2 logs them-bot
```

2. Using provided scripts:
```bash
# For development with auto-reload
npm run bot

# For production
npm run bot:prod
```

#### Stopping the Bot
```bash
# If using PM2
pm2 stop them-bot
pm2 delete them-bot

# If running in terminal
Press Ctrl+C
```

#### Auto-start with Windows
```bash
# Generate startup script
pm2 startup
# Save current process list
pm2 save
```

### CLI Commands
The CLI interface is separate from the Discord bot and can be used independently:

```bash
# Start a new chat (default model is gpt)
them chat

# Start a chat with specific model
them chat -m claude
them chat -m gpt
them chat -m ollama

# List recent conversations
them list

# Show a specific conversation
them show <id>

# Continue a conversation
them continue <id>

# Delete a conversation
them delete <id>
```

## Monitoring and Maintenance

### PM2 Commands
- `pm2 monit` - Real-time monitoring
- `pm2 logs them-bot` - View bot logs
- `pm2 status` - Check bot status
- `pm2 restart them-bot` - Restart the bot
- `pm2 reload them-bot` - Zero-downtime reload

### Automatic Cleanup
- Inactive sessions are automatically cleaned up
- Default cleanup interval: 24 hours
- Default session timeout: 1 hour

## Commands

- `chat [-m model]` - Start a new chat (model: gpt/claude)
- `list [-l limit]` - List recent conversations
- `show <id>` - Show a specific conversation
- `continue <id>` - Continue an existing conversation
- `delete <id>` - Delete a conversation

## Configuration

The application can be configured through environment variables:

### Using Ollama

To use Ollama with the bot:

1. Install Ollama from [ollama.ai](https://ollama.ai)
2. Pull your desired model:
   ```bash
   ollama pull llama2:13b-instruct-q8_0
   ```
3. Configure in your .env file:
   ```env
   MODEL=gpt // ollama, claude
   OLLAMA_HOST=http://127.0.0.1:11434
   OLLAMA_MODEL=llama3.2.latest
   ```

### Model Selection

The default model can be configured in two ways:

1. Environment Variable (applies to both CLI and Discord bot):
   ```env
   MODEL=gpt  # Options: gpt, claude, deepseek, ollama
   ```
   This setting will be used whenever a specific model is not provided.

2. Command Line (overrides environment setting):
   ```bash
   them chat -m ollama
   ```

### General Settings
- `DEBUG=true` - Enable debug logging
- `MAX_CONTEXT_MESSAGES=10` - Number of previous messages to keep for context
- `MAX_MESSAGE_LENGTH=4000` - Maximum length of input messages
- `MAX_RETRIES=3` - Number of retry attempts for rate-limited API calls
- `RETRY_DELAY=1000` - Delay between retries in milliseconds

## Debug Mode

Enable debug mode by setting `DEBUG=true` in your `.env` file. This will log:
- API requests and responses
- Database operations
- Error details
- Conversation flow

## License

ISC
