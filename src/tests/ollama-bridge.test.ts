import { expect } from 'chai';
import { OllamaBridge } from '../services/ai/utils/ollama_helpers/ollama-bridge';
import { MCPClientService } from '../tools/mcp/mcp-client-service.js';
import mcpServers from '../tools/mcp/mcp_config.js';
import fs from 'fs/promises';
import path from 'path';
import { ToolsHandler } from '../tools/tools-handler';
import { MCPServerManager } from '../tools/mcp/mcp-server-manager';
import { DatabaseService } from '../services/db-service';
import { OllamaService } from '../services/ai/ollama';

describe('OllamaBridge', function() {
  this.timeout(1200000); // 20 minutes timeout for all tests
  
  let bridge: OllamaBridge;
  let braveClient: MCPClientService;

  before(async function() {
    // Initialize Brave Search client
    braveClient = new MCPClientService(mcpServers.mcpServers["brave-search"]);
    await braveClient.initialize();

    // Create bridge with just the Brave Search client
    const clients = new Map();
    clients.set("brave-search", braveClient);
    
    // Create services
    const ollamaService = new OllamaService();
    const mcpManager = new MCPServerManager(await DatabaseService.getInstance(), ollamaService);
    const toolsHandler = new ToolsHandler([{ id: "brave-search", client: braveClient }], ollamaService, await DatabaseService.getInstance());

    bridge = new OllamaBridge("llama3.2:latest", "http://127.0.0.1:11434", clients, mcpManager, toolsHandler);

    // Update available tools
    const tools = await braveClient.listTools();
    await bridge.updateAvailableTools(tools);
  });

  after(async function() {
    braveClient.cleanup();
  });

  it('should handle simple response without tool use', async () => {
    try {
      const response = await bridge.processMessage("Say hello and nothing else.");
      console.log('\nSimple response test result:', response);
      expect(response).to.be.a('string');
      expect(response.toLowerCase()).to.include('hello');
    } catch (error) {
      console.error('Test error:', error);
      throw error;
    }
  });

  it('should successfully use brave_web_search tool and include URLs', async () => {
    try {
      const response = await bridge.processMessage(
        "Search news about USA anouncing cryptocurrency national reservers. Print out the 3 of them that are picked. Include urls in the file."
      );
      console.log('\nBrave search test result:', response);
      
      // Save the response to a file
      const outputDir = path.join(process.cwd(), 'test-results');
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(
        path.join(outputDir, 'cryptocurrency-national-reservers.txt'),
        response,
        'utf-8'
      );

      expect(response).to.be.a('string');
      expect(response).to.not.be.empty;
      expect(response.length).to.be.greaterThan(100);
      expect(response).to.include('http');  // Should contain at least one URL
      
      // Count the number of URLs
      const urlCount = (response.match(/https?:\/\//g) || []).length;
      expect(urlCount).to.be.at.least(3, 'Response should contain at least 3 URLs');
    } catch (error) {
      console.error('Test error:', error);
      throw error;
    }
  });
}); 