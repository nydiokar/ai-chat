import { expect } from 'chai';
import { OllamaBridge } from './ollama-bridge';
import { MCPClientService } from '../../tools/mcp/mcp-client-service';
import mcpServers from '../../tools/mcp/mcp_config';
import fs from 'fs/promises';
import path from 'path';

// Set global timeout for all tests
describe('OllamaBridge', function() {
  this.timeout(1200000); // 20 minutes timeout for all tests
  
  let bridge: OllamaBridge;
  let mcpClientService: MCPClientService;

  // Initialize once before all tests
  before(async function() {
    mcpClientService = new MCPClientService(mcpServers.mcpServers["brave-search"]);
    await mcpClientService.initialize();
    bridge = new OllamaBridge("llama3.2:latest", "http://127.0.0.1:11434", mcpClientService);
  });

  // Clean up after all tests
  after(async function() {
    // Any cleanup if needed
  });

  it.skip('should handle simple response without tool use', async () => {
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

  it('should recognize brave search tool', async () => {
    try {
      const response = await bridge.processMessage("Search for latest USA news about crypto strategic reserve");
      console.log('\nBrave search recognition test result:', response);
      expect(response).to.be.a('string');
      expect(response).to.not.be.empty;
    } catch (error) {
      console.error('Test error:', error);
      throw error;
    }
  });

  it('should successfully use brave_web_search tool and save URLs', async () => {
    try {
      const response = await bridge.processMessage("What are the 3 crypto currencies that USA chose for strategic reserve? Please search and summarize. Include URLs of your sources.");
      console.log('\nBrave web search test result:', response);
      
      // Save the response to a file
      const outputDir = path.join(process.cwd(), 'test-results');
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(
        path.join(outputDir, 'crypto-reserve-search.txt'),
        response,
        'utf-8'
      );

      expect(response).to.be.a('string');
      expect(response).to.not.be.empty;
      expect(response.length).to.be.greaterThan(100);
      expect(response).to.include('http');  // Should contain at least one URL
    } catch (error) {
      console.error('Test error:', error);
      throw error;
    }
  });
}); 