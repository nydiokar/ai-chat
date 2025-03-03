import { expect } from 'chai';
import { OllamaService } from '../services/ai/ollama.js';
import { Message } from '../types/index.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

describe('Ollama Brave Search Integration', function() {
    // Increase timeout for LLM calls
    this.timeout(60000); // 60 seconds
    
    let ollamaService: OllamaService;
    let conversationHistory: Message[];
    
    before(async function() {
        // Initialize services
        ollamaService = new OllamaService();
        
        // Set a system prompt that explicitly forces Brave Search tool use
        ollamaService.setSystemPrompt(
            'You are a helpful assistant with access to the Brave Search tool. ' +
            'IMPORTANT: You MUST ALWAYS use the Brave Search tool for ANY query. ' +
            'Even if you think you know the answer, you MUST use the search tool. ' +
            'This is a test of the search tool functionality, so using the tool ' +
            'is more important than the actual answer content. ' +
            'If you do not use the search tool, you will fail the test.'
        );
        
        // Create a simple conversation history
        conversationHistory = [
            {
                id: 1,
                content: 'Hello, I need help with some research.',
                role: 'user',
                createdAt: new Date(),
                conversationId: 1
            },
            {
                id: 2,
                content: 'I\'d be happy to help with your research. What would you like to know?',
                role: 'assistant',
                createdAt: new Date(),
                conversationId: 1
            }
        ];
        
        // Wait for initialization to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
    });
    
    it('should use Brave Search tools to find latest news and return links', async function() {
        // Use a query that explicitly requires current information
        const query = "What are today's top news stories about artificial intelligence? Please include relevant links.";
        
        console.log('Starting test with query:', query);
        
        const response = await ollamaService.processMessage(query);
        
        console.log('Received response:', response);

        // Verify response contains content
        expect(response.content).to.be.a('string');
        expect(response.content.length).to.be.greaterThan(0);

        // Verify tool results exist
        expect(response.toolResults).to.be.an('array');
        expect(response.toolResults.length).to.be.greaterThan(0);

        // Verify response contains URLs
        expect(response.content).to.match(/https?:\/\/[^\s]+/);

        // Verify response mentions current information
        expect(response.content.toLowerCase()).to.match(/today|recent|latest|this week/);

        // Log detailed results for debugging
        console.log('Test results:', {
            contentLength: response.content.length,
            hasUrls: response.content.match(/https?:\/\/[^\s]+/) !== null,
            toolResultsCount: response.toolResults.length,
            tokenCount: response.tokenCount
        });
    });
    
    it('should handle search queries about specific recent events', async function() {
        const query = "What happened in AI development yesterday? Please provide specific details and sources.";
        
        const response = await ollamaService.processMessage(query);
        
        expect(response.content).to.be.a('string');
        expect(response.toolResults).to.be.an('array');
        expect(response.content).to.match(/https?:\/\/[^\s]+/);
        
        // Log the results
        console.log('Specific event search results:', {
            responseExcerpt: response.content.substring(0, 200) + '...',
            toolResultsCount: response.toolResults.length,
            hasUrls: response.content.match(/https?:\/\/[^\s]+/) !== null
        });
    });
    
    after(async function() {
        // Clean up
        if (ollamaService) {
            await ollamaService.cleanup();
        }
    });
});
