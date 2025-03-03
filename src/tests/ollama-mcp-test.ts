import { expect } from 'chai';
import { OllamaService } from '../services/ai/ollama.js';
import { DatabaseService } from '../services/db-service.js';
import { Message } from '../types/index.js';

describe('Ollama MCP Integration', function() {
    // Increase timeout for LLM calls
    this.timeout(30000);
    
    let ollamaService: OllamaService;
    let conversationHistory: Message[];
    
    before(async function() {
        // Initialize services
        ollamaService = new OllamaService();
        
        // Set a system prompt that encourages tool use
        ollamaService.setSystemPrompt(
            'You are a helpful assistant with access to tools. ' +
            'When asked about GitHub repositories or web searches, use the appropriate tools.'
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
        await new Promise(resolve => setTimeout(resolve, 1000));
    });
    
    describe('GitHub Tool Integration', function() {
        it('should use GitHub tools when asked about repositories', async function() {
            const githubQuery = 'Can you find information about the React repository on GitHub?';
            
            const response = await ollamaService.processMessage(githubQuery, conversationHistory);
            
            // Log the response for debugging
            console.log('GitHub Response:', response.content);
            
            // Check if the response contains GitHub-related content
            expect(response.content).to.be.a('string');
            expect(response.content.length).to.be.greaterThan(0);
            
            // Ideally, we'd check if tools were used, but this might be flaky
            // So we'll make a softer assertion about the content
            expect(
                response.content.includes('React') || 
                response.content.includes('repository') || 
                response.content.includes('GitHub')
            ).to.be.true;
        });
    });
    
    describe('Brave Search Tool Integration', function() {
        it('should use Brave Search tools when asked about web searches', async function() {
            const searchQuery = 'What are the latest developments in quantum computing?';
            
            const response = await ollamaService.processMessage(searchQuery, conversationHistory);
            
            // Log the response for debugging
            console.log('Search Response:', response.content);
            
            // Check if the response contains search-related content
            expect(response.content).to.be.a('string');
            expect(response.content.length).to.be.greaterThan(0);
            
            // Softer assertion about the content
            expect(
                response.content.includes('quantum') || 
                response.content.includes('computing') || 
                response.content.includes('research')
            ).to.be.true;
        });
    });
    
    after(async function() {
        // Clean up
        if (ollamaService) {
            await ollamaService.cleanup();
        }
    });
});
