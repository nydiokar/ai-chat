import { expect } from 'chai';
import { OllamaService } from '../services/ai/ollama.js';
import { MCPServerManager } from '../tools/mcp/mcp-server-manager.js';
import { DatabaseService } from '../services/db-service.js';

describe('Ollama Search Integration', () => {
    let ollama: OllamaService;
    let mcpManager: MCPServerManager | undefined;
    let db: DatabaseService;

    before(async function() {
        this.timeout(30000);
        db = DatabaseService.getInstance();
        await db.connect();
        
        ollama = new OllamaService();
        mcpManager = ollama['mcpManager'];
        
        if (!mcpManager) {
            throw new Error('MCP Manager not initialized');
        }

        await ollama['toolsInitPromise'];
        console.log('[Test] Setup complete');
    });

    it('should execute search and get results', async function() {
        this.timeout(60000);
        
        const response = await ollama.generateResponse(
            'What are the 3 crypto currencies that USA picked to make national reserve of? Use Brave Search to find recent articles.'
        );
        
        console.log('\n[Test] Response:', {
            hasResults: response.toolResults.length > 0,
            resultCount: response.toolResults[0]?.result?.length,
            summary: response.content.substring(0, 100) + '...'
        });

        expect(response.toolResults).to.have.length.above(0);
        expect(response.toolResults[0].result).to.be.an('array');
        expect(response.content).to.be.a('string').and.not.to.include('{"query":');
    });

    it('should handle requests with result limits', async function() {
        this.timeout(60000);
        
        const response = await ollama.generateResponse(
            'Find exactly 2 recent articles about quantum computing.'
        );

        console.log('\n[Test] Limited results:', {
            resultCount: response.toolResults[0]?.result?.length
        });

        expect(response.toolResults[0].result)
            .to.be.an('array')
            .with.length.at.most(2);
    });

    after(async () => {
        if (mcpManager) {
            await mcpManager.stopServer('brave-search');
        }
        await db.disconnect();
        console.log('[Test] Cleanup complete');
    });
});
