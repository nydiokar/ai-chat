#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { OpenAIService } from './services/ai/openai-service.js';
import { AnthropicService } from './services/ai/anthropic-service.js';
import { DatabaseService } from './services/db-service.js';
import { Message } from './types/index.js';
import { createInterface } from 'readline';
import { defaultConfig, validateInput, debug, validateEnvironment } from './utils/config.js';

import { MCPServerManager } from './services/mcp/mcp-server-manager.js';
import { AIServiceFactory } from './services/ai-service-factory.js';
import { getMCPConfig } from './types/mcp-config.js';
import { MCPClientService } from './services/mcp/mcp-client-service.js';

dotenv.config();
validateEnvironment();

const program = new Command();
const db = DatabaseService.getInstance();
const aiService = AIServiceFactory.create('gpt');
const mcpManager = new MCPServerManager(db, aiService);

program
  .name('ai-chat')
  .description('CLI tool for chatting with GPT and Claude')
  .version('1.0.0');

program
  .command('chat')
  .description('Start a new chat conversation')
  .option('-m, --model <model>', 'Choose AI model (gpt/claude)', 'gpt')
  .action(async (options) => {
    try {
      debug('Starting new chat session');
      const service = options.model === 'gpt' 
        ? new OpenAIService() 
        : new AnthropicService();
      
      const conversationId = await db.createConversation(service.getModel());
      debug(`Created conversation with ID: ${conversationId}`);
      console.log(`Started new conversation (ID: ${conversationId})`);
      console.log('Type "exit" to end the conversation\n');

      const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const askQuestion = () => {
        readline.question('You: ', async (input: string) => {
          const inputError = validateInput(input);
          if (inputError) {
            console.error(`Error: ${inputError}`);
            askQuestion();
            return;
          }

          if (input.toLowerCase() === 'exit') {
            debug('Ending chat session');
            readline.close();
            return;
          }

          try {
            debug(`Processing user input: ${input}`);
            await db.addMessage(conversationId, input, 'user');
            
            let response: string | null = null;
            let retries = 0;
            
            // Get conversation history for context
            const conversation = await db.getConversation(conversationId);
            if (!conversation) {
              throw new Error('Failed to retrieve conversation');
            }
            
            while (retries < defaultConfig.maxRetries && !response) {
              try {
                debug(`Attempt ${retries + 1} to get AI response`);
                const result = await service.generateResponse(input, conversation.messages.map(validateMessage));
                response = result.content;
                
                // First save
                await db.addMessage(conversationId, result.content, 'assistant', result.tokenCount);
                
                console.log(`\nAssistant: ${result.content}\n`);
              } catch (error: any) {
                retries++;
                if (error.message.includes('rate limit') && retries < defaultConfig.maxRetries) {
                  console.log(`Rate limit hit, retrying in ${defaultConfig.retryDelay/1000}s...`);
                  await new Promise(resolve => setTimeout(resolve, defaultConfig.retryDelay));
                } else {
                  throw error;
                }
              }
            }

            if (!response) {
              throw new Error('Failed to get response after retries');
            }

            debug('Received AI response, saving to database');
            await db.addMessage(conversationId, response, 'assistant');
            console.log(`\nAssistant: ${response}\n`);
          } catch (error: any) {
            console.error('Error:', error.message);
            console.log('Try again or type "exit" to end the conversation\n');
            debug(`Error in conversation: ${error.message}`);
          }

          askQuestion();
        });
      };

      askQuestion();
    } catch (error: any) {
      console.error('Error:', error.message);
      debug(`Fatal error in chat session: ${error.message}`);
    }
  });

program
  .command('list')
  .description('List recent conversations')
  .option('-l, --limit <number>', 'Number of conversations to show', '10')
  .action(async (options) => {
    try {
      debug(`Listing conversations with limit: ${options.limit}`);
      const conversations = await db.listConversations(parseInt(options.limit));
      conversations.forEach((conv: any) => {
        console.log(`\nConversation ${conv.id} (${conv.model}) - ${conv.createdAt}`);
        console.log('Messages:', conv.messages.length);
      });
    } catch (error: any) {
      console.error('Error:', error.message);
      debug(`Error listing conversations: ${error.message}`);
    }
  });

program
  .command('show')
  .description('Show a specific conversation')
  .argument('<id>', 'Conversation ID')
  .action(async (id) => {
    try {
      debug(`Showing conversation ${id}`);
      const conversation = await db.getConversation(parseInt(id));
      if (!conversation) {
        console.error('Conversation not found');
        return;
      }

      console.log(`\nConversation ${conversation.id} (${conversation.model})`);
      console.log('Created at:', conversation.createdAt);
      console.log('\nMessages:\n');
      
      conversation.messages.map(validateMessage).forEach((msg: Message) => {
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        console.log(`${role}: ${msg.content}\n`);
      });
    } catch (error: any) {
      console.error('Error:', error.message);
      debug(`Error showing conversation: ${error.message}`);
    }
  });

program
  .command('delete')
  .description('Delete a conversation')
  .argument('<id>', 'Conversation ID')
  .action(async (id) => {
    try {
      debug(`Deleting conversation ${id}`);
      await db.deleteConversation(parseInt(id));
      console.log(`Conversation ${id} deleted successfully`);
    } catch (error: any) {
      console.error('Error:', error.message);
      debug(`Error deleting conversation: ${error.message}`);
    }
  });

program
  .command('continue')
  .description('Continue an existing conversation')
  .argument('<id>', 'Conversation ID')
  .action(async (id) => {
    try {
      debug(`Continuing conversation ${id}`);
      const conversation = await db.getConversation(parseInt(id));
      if (!conversation) {
        console.error('Conversation not found');
        return;
      }

      const service = conversation.model === 'gpt' 
        ? new OpenAIService() 
        : new AnthropicService();

      console.log(`\nContinuing conversation ${id} (${conversation.model})`);
      console.log('Previous messages:\n');
      
      conversation.messages.map(validateMessage).forEach((msg: Message) => {
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        console.log(`${role}: ${msg.content}\n`);
      });

      console.log('Type "exit" to end the conversation\n');

      const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const askQuestion = () => {
        readline.question('You: ', async (input: string) => {
          const inputError = validateInput(input);
          if (inputError) {
            console.error(`Error: ${inputError}`);
            askQuestion();
            return;
          }

          if (input.toLowerCase() === 'exit') {
            debug('Ending continued conversation');
            readline.close();
            return;
          }

          try {
            debug(`Processing user input in continued conversation: ${input}`);
            await db.addMessage(conversation.id, input, 'user');
            
            let response: string | null = null;
            let retries = 0;
            
            // Get updated conversation history
            const updatedConversation = await db.getConversation(conversation.id);
            if (!updatedConversation) {
              throw new Error('Failed to retrieve conversation');
            }
            
            while (retries < defaultConfig.maxRetries && !response) {
              try {
                debug(`Attempt ${retries + 1} to get AI response`);
                const result = await service.generateResponse(input, updatedConversation.messages.map(validateMessage));
                response = result.content;
                await db.addMessage(conversation.id, result.content, 'assistant', result.tokenCount ?? undefined);
              } catch (error: any) {
                retries++;
                if (error.message.includes('rate limit') && retries < defaultConfig.maxRetries) {
                  console.log(`Rate limit hit, retrying in ${defaultConfig.retryDelay/1000}s...`);
                  await new Promise(resolve => setTimeout(resolve, defaultConfig.retryDelay));
                } else {
                  throw error;
                }
              }
            }

            if (!response) {
              throw new Error('Failed to get response after retries');
            }

            debug('Received AI response, saving to database');
            await db.addMessage(conversation.id, response, 'assistant');
            console.log(`\nAssistant: ${response}\n`);
          } catch (error: any) {
            console.error('Error:', error.message);
            console.log('Try again or type "exit" to end the conversation\n');
            debug(`Error in continued conversation: ${error.message}`);
          }

          askQuestion();
        });
      };

      askQuestion();
    } catch (error: any) {
      console.error('Error:', error.message);
      debug(`Fatal error in continued conversation: ${error.message}`);
    }
  });

program
  .command('mcp')
  .description('MCP (Model Context Protocol) commands')
  .command('brave-web-search')
  .description('Perform a web search using Brave Search')
  .argument('<query>', 'Search query')
  .option('-c, --count <number>', 'Number of results (max 20)', '10')
  .action(async (query, options) => {
    try {
      const mcpConfig = getMCPConfig();
      const braveConfig = mcpConfig.mcpServers['brave-search'];
      if (!braveConfig) {
        throw new Error('Brave search server not configured');
      }

      const client = new MCPClientService(braveConfig);
      await client.connect();
      
      const results = await client.webSearch(query, parseInt(options.count));
      console.log('\nSearch Results:\n');
      console.log(results);
      
      await client.cleanup();
    } catch (error: any) {
      console.error('Error:', error.message);
      debug(`Error in Brave web search: ${error.message}`);
    }
  });

program
  .command('mcp')
  .description('MCP (Model Context Protocol) commands')
  .command('brave-local-search')
  .description('Search for local businesses using Brave Search')
  .argument('<query>', 'Search query (e.g., "pizza near Central Park")')
  .option('-c, --count <number>', 'Number of results (max 20)', '5')
  .action(async (query, options) => {
    try {
      const mcpConfig = getMCPConfig();
      const braveConfig = mcpConfig.mcpServers['brave-search'];
      if (!braveConfig) {
        throw new Error('Brave search server not configured');
      }

      const client = new MCPClientService(braveConfig);
      await client.connect();
      
      const results = await client.localSearch(query, parseInt(options.count));
      console.log('\nLocal Search Results:\n');
      console.log(results);
      
      await client.cleanup();
    } catch (error: any) {
      console.error('Error:', error.message);
      debug(`Error in Brave local search: ${error.message}`);
    }
  });

program
  .command('mcp')
  .description('MCP (Model Context Protocol) commands')
  .command('list-tools')
  .description('List available MCP tools')
  .action(async () => {
    try {
      const mcpConfig = getMCPConfig();
      console.log('\nAvailable MCP Servers:');
      for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
        console.log(`\n${name}`);
        const server = new MCPClientService(config);
        await server.connect();
        const tools = await server.listTools();
        tools.forEach(tool => {
          console.log(`  - ${tool.name}: ${tool.description}`);
        });
        await server.cleanup();
      }
    } catch (error: any) {
      console.error('Error:', error.message);
      debug(`Error listing MCP tools: ${error.message}`);
    }
  });

program
  .command('mcp-chat')
  .description('Start a chat session with MCP tools enabled')
  .option('-m, --model <model>', 'Choose AI model (gpt/claude)', 'gpt')
  .action(async (options) => {
    try {
      const config = getMCPConfig();
      const serverId = 'default';
      
      if (!mcpManager.hasServer(serverId)) {
        const serverConfig = config.mcpServers[serverId];
        await mcpManager.startServer(serverId, serverConfig);
      }

      console.log(`\nStarting new MCP-enabled chat session`);
      console.log('Available commands:');
      console.log('  /search <query>  - Perform a web search');
      console.log('Type "exit" to end the conversation\n');

      const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const conversationId = await db.createConversation(options.model);

      const askQuestion = () => {
        readline.question('You: ', async (input: string) => {
          if (input.toLowerCase() === 'exit') {
            debug('Ending chat session');
            readline.close();
            return;
          }

          try {
            // Check for direct search commands
            if (input.startsWith('/search ')) {
              const query = input.slice(8);
              const config = getMCPConfig();
              const braveConfig = config.mcpServers['brave-search'];
              if (braveConfig) {
                const client = new MCPClientService(braveConfig);
                await client.connect();
                const results = await client.webSearch(query);
                console.log('\nSearch Results:\n');
                console.log(results);
                await client.cleanup();
              }
            } 
            else if (input.startsWith('/local ')) {
              const query = input.slice(7);
              const config = getMCPConfig();
              const braveConfig = config.mcpServers['brave-search'];
              if (braveConfig) {
                const client = new MCPClientService(braveConfig);
                await client.connect();
                const results = await client.localSearch(query);
                console.log('\nLocal Search Results:\n');
                console.log(results);
                await client.cleanup();
              }
            }
            else {
              const response = await mcpManager.executeToolQuery(serverId, input, conversationId);
              console.log(`\nAssistant: ${response}\n`);
            }
          } catch (error: any) {
            console.error('Error:', error.message);
            debug(`Error in MCP conversation: ${error.message}`);
          }
          
          askQuestion();
        });
      };

      askQuestion();
    } catch (error: any) {
      console.error('Error:', error.message);
      debug(`Error starting MCP chat: ${error.message}`);
    }
  });

program
  .command('test-chat')
  .description('Test basic AI chat functionality without MCP tools')
  .option('-m, --model <model>', 'Choose AI model (gpt/claude)', 'gpt')
  .action(async (options) => {
    try {
      const aiService = AIServiceFactory.create(options.model);
      const db = DatabaseService.getInstance();
      
      console.log(`\nStarting new chat session with ${options.model}`);
      console.log('Type "exit" to end the conversation\n');

      const readline = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const conversationId = await db.createConversation(options.model);
      const messages: Message[] = [];

      const askQuestion = () => {
        readline.question('You: ', async (input: string) => {
          if (input.toLowerCase() === 'exit') {
            readline.close();
            return;
          }

          try {
            messages.push(validateMessage({
              role: 'user',
              content: input,
              conversationId,
              createdAt: new Date(),
              id: 0
            }));

            const response = await aiService.generateResponse(input, messages.map(validateMessage));
            console.log(`\nAssistant: ${response.content}\n`);

            messages.push(validateMessage({
              role: 'assistant',
              content: response.content,
              conversationId,
              createdAt: new Date(),
              id: 0
            }));
          } catch (error: any) {
            console.error('Error:', error.message);
          }
          
          askQuestion();
        });
      };

      askQuestion();
    } catch (error: any) {
      console.error('Error:', error.message);
    }
  });

// Add graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  await db.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nGracefully shutting down...');
  await db.disconnect();
  process.exit(0);
});

program.parse();

function validateMessage(msg: any): Message {
  if (msg.role !== 'user' && msg.role !== 'assistant' && msg.role !== 'system') {
    throw new Error(`Invalid message role: ${msg.role}`);
  }
  return {
    ...msg,
    role: msg.role as "user" | "assistant" | "system"
  };
}
