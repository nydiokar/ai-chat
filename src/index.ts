#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { OpenAIService, AnthropicService } from './services/ai-service';
import { DatabaseService } from './services/db-service';
import { DiscordService } from './services/discord-service';
import { Conversation, Message } from './types';
import { createInterface } from 'readline';
import { defaultConfig, validateInput, debug, validateEnvironment } from './config';

dotenv.config();
validateEnvironment();

const program = new Command();
const db = DatabaseService.getInstance();

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
                const result = await service.generateResponse(input, conversation.messages);
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
      
      conversation.messages.forEach((msg: Message) => {
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
      
      conversation.messages.forEach((msg: Message) => {
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
                const result = await service.generateResponse(input, updatedConversation.messages);
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
