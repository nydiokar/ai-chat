# Them - AI Chat CLI & Discord Bot

A versatile tool for chatting with GPT and Claude AI models through both CLI and Discord, with local conversation storage.

## Features

- Multi-interface Support:
  - Command-line interface for direct chat
  - Discord bot for team collaboration
- AI Integration:
  - Chat with OpenAI's GPT or Anthropic's Claude
  - Smart context management
  - Automatic retry on API rate limits
- Conversation Management:
  - Local storage using SQLite
  - List, show, continue, and delete conversations
  - Session tracking for Discord users
  - Automatic cleanup of inactive sessions
- User Experience:
  - Input validation and error handling
  - Debug mode for troubleshooting
  - Configurable settings

## Prerequisites

- Node.js (v16 or higher)
- npm
- OpenAI API key
- Anthropic API key

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

3. Create a `.env` file in the root directory with your API keys and configuration:
```env
# API Keys
OPENAI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here

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

### Start a new chat
```bash
# Chat with GPT (default)
them chat

# Chat with Claude
them chat -m claude
```

### List recent conversations
```bash
# Show last 10 conversations (default)
them list

# Show last 5 conversations
them list -l 5
```

### Show a specific conversation
```bash
them show <conversation-id>
```

### Continue a conversation
```bash
them continue <conversation-id>
```

### Delete a conversation
```bash
them delete <conversation-id>
```

### Development
```bash
# Run in development mode with auto-reload
npm run dev
```

## Commands

- `chat [-m model]` - Start a new chat (model: gpt/claude)
- `list [-l limit]` - List recent conversations
- `show <id>` - Show a specific conversation
- `continue <id>` - Continue an existing conversation
- `delete <id>` - Delete a conversation

## Configuration

The application can be configured through environment variables and the config file:

### General Settings
- `DEBUG=true` - Enable debug logging
- `MAX_CONTEXT_MESSAGES=10` - Number of previous messages to keep for context
- `MAX_MESSAGE_LENGTH=4000` - Maximum length of input messages
- `MAX_RETRIES=3` - Number of retry attempts for rate-limited API calls
- `RETRY_DELAY=1000` - Delay between retries in milliseconds

### Discord Settings
- `DISCORD_ENABLED=true` - Enable Discord bot functionality
- `DISCORD_TOKEN` - Your Discord bot token
- Session Management:
  - `cleanupInterval: 24` - Hours between inactive session cleanup (default: 24)
  - `sessionTimeout: 1` - Hours before a session is considered inactive (default: 1)

## Error Handling

- Input validation for message length and content
- Automatic retry on API rate limits (configurable attempts and delay)
- Graceful error handling for network issues
- Clear error messages for missing API keys or database issues
- Debug logging for troubleshooting

## Debug Mode

Enable debug mode by setting `DEBUG=true` in your `.env` file. This will log:
- API requests and responses
- Database operations
- Error details
- Conversation flow
- Discord bot events and operations
- Session management activities

## License

ISC
