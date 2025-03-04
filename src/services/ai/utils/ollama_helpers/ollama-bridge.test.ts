import { expect } from 'chai';
import { OllamaBridge } from './ollama-bridge.js';
import { MCPClientService } from '../../../../tools/mcp/mcp-client-service.js';
import mcpServers from '../../../../tools/mcp/mcp_config.js';
import fs from 'fs/promises';
import path from 'path';

describe('OllamaBridge', function() {
    this.timeout(1200000); // 20 minutes timeout for all tests
    
    let bridge: OllamaBridge;
    let braveClient: MCPClientService;
    let githubClient: MCPClientService;
    let clients: Map<string, MCPClientService>;
    let createdIssueNumber: number | null = null;
    const outputDir = path.join(process.cwd(), 'test-results');

    before(async function() {
        // Initialize clients using mcpServers config
        braveClient = new MCPClientService(mcpServers.mcpServers["brave-search"]);
        await braveClient.initialize();

        githubClient = new MCPClientService(mcpServers.mcpServers["github"]);
        await githubClient.initialize();

        // Create clients map
        clients = new Map();
        clients.set("brave-search", braveClient);
        clients.set("github", githubClient);

        // Initialize bridge
        bridge = new OllamaBridge("llama3.2:latest", "http://127.0.0.1:11434", clients);

        // Get available tools from both clients
        const braveTools = await braveClient.listTools();
        const githubTools = await githubClient.listTools();
        await bridge.updateAvailableTools([...braveTools, ...githubTools]);

        // Create output directory for test results
        await fs.mkdir(outputDir, { recursive: true });
    });

    describe('Basic Functionality', () => {
        it('should handle a basic response without tool use', async () => {
            const response = await bridge.processMessage('Say hello and nothing else.');
            console.log('\nSimple response test result:', response);
            expect(response).to.be.a('string');
            expect(response.toLowerCase()).to.include('hello');
        });

        it('should maintain conversation context', async () => {
            await bridge.processMessage('My name is Alice');
            const response = await bridge.processMessage('What is my name?');
            expect(response.toLowerCase()).to.include('alice');
        });
    });

    describe('Web Search Tool', () => {
        it('should use web search tool for cryptocurrency news', async () => {
            const response = await bridge.processMessage(
                "Search news about USA announcing cryptocurrency national reserves. Print out the 3 of them that are picked. Include urls in the file."
            );
            console.log('\nBrave search test result:', response);
            
            // Save the response to a file
            await fs.writeFile(
                path.join(outputDir, 'cryptocurrency-national-reserves.txt'),
                response,
                'utf-8'
            );

            expect(response).to.be.a('string');
            expect(response.length).to.be.greaterThan(100);
            expect(response).to.include('http');
            
            // Count the number of URLs
            const urlCount = (response.match(/https?:\/\//g) || []).length;
            expect(urlCount).to.be.at.least(3, 'Response should contain at least 3 URLs');
        });

        it('should handle web search with specific parameters', async () => {
            const response = await bridge.processMessage('Find news about AI from the last 24 hours');
            await fs.writeFile(
                path.join(outputDir, 'ai-news.txt'),
                response,
                'utf-8'
            );
            expect(response).to.be.a('string');
            expect(response).to.match(/https?:\/\//);
            expect(response).to.match(/202[34]/);
        });

        it('should handle failed web searches gracefully', async () => {
            const response = await bridge.processMessage('Search for xyznonexistentquery123456789');
            expect(response).to.be.a('string');
            expect(response).to.match(/no results|not found|unable to find/i);
        });
    });

    describe('GitHub Tool', () => {
        it('should use GitHub tool to create an issue', async () => {
            const response = await bridge.processMessage(
                'Create a GitHub issue in nydiokar/ai-chat repository with title "Test Issue from OllamaBridge" ' +
                'and description "This is a test issue created by the OllamaBridge integration test."'
            );
            console.log('\nGitHub issue creation result:', response);
            
            expect(response).to.be.a('string');
            expect(response).to.include('issue');
            expect(response).to.include('created');
            
            // Extract issue number for cleanup
            const match = response.match(/#(\d+)/);
            if (match) {
                createdIssueNumber = parseInt(match[1]);
            }
            
            expect(response).to.match(/(https:\/\/github\.com\/|#\d+)/);
        });
    });

    describe('Error Handling', () => {
        it('should handle multiple tool calls in sequence', async () => {
            const response = await bridge.processMessage(
                'Search for the latest AI news and create a GitHub issue summarizing the findings'
            );
            console.log('\nMultiple tool calls result:', response);
            
            expect(response).to.be.a('string');
            expect(response).to.match(/https?:\/\//);
            expect(response).to.match(/#\d+/);

            await fs.writeFile(
                path.join(outputDir, 'ai-news-github-issue.txt'),
                response,
                'utf-8'
            );
        });
    });

    after(async () => {
        // Cleanup created issue if we have its number
        if (createdIssueNumber) {
            try {
                await githubClient.callTool('github_close_issue', {
                    owner: 'nydiokar',
                    repo: 'ai-chat',
                    issue_number: createdIssueNumber
                });
                console.log(`Cleaned up test issue #${createdIssueNumber}`);
            } catch (error) {
                console.error('Failed to cleanup test issue:', error);
            }
        }

        // Cleanup clients
        for (const [_, client] of clients) {
            await client.cleanup();
        }
    });
}); 