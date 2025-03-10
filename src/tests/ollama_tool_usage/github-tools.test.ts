import { expect } from 'chai';
import { MCPClientService } from "../../tools/mcp/mcp-client-service.js";
import mcpServers from '../../tools/mcp/mcp_config.js';

describe('GitHub MCP Tools', function() {
    this.timeout(30000);
    let githubClient: MCPClientService;

    before(async function() {
        githubClient = new MCPClientService(mcpServers.mcpServers["github"]);
        await githubClient.initialize();
    });

    it('should list available GitHub tools', async () => {
        const tools = await githubClient.listTools();
        console.log('Available GitHub tools:', tools.map(t => t.name));
        expect(tools).to.be.an('array').that.is.not.empty;
    });

    it('should create a new issue', async () => {
        const result = await githubClient.callTool('create_issue', {
            owner: 'nydiokar',
            repo: 'ai-chat',
            title: 'Test Issue from GitHub Tools Test',
            body: 'This is a test issue created to verify GitHub tool functionality.'
        });
        
        console.log('Create issue result:', result);
        const data = JSON.parse(result);
        expect(data).to.have.nested.property('content[0].text');
        
        const issueData = JSON.parse(data.content[0].text);
        expect(issueData).to.have.property('number').that.is.a('number');
    });

    it('should comment on issue #25', async () => {
        const result = await githubClient.callTool('add_issue_comment', {
            owner: 'nydiokar',
            repo: 'ai-chat',
            issue_number: 25,
            body: 'Test comment from GitHub tools test'
        });

        console.log('Add comment result:', result);
        const data = JSON.parse(result);
        expect(data).to.have.nested.property('content[0].text');
        
        const commentData = JSON.parse(data.content[0].text);
        expect(commentData).to.have.property('id').that.is.a('number');
    });

    it('should close issue #25', async () => {
        const result = await githubClient.callTool('update_issue', {
            owner: 'nydiokar',
            repo: 'ai-chat',
            issue_number: 25,
            state: 'closed'
        });

        console.log('Close issue result:', result);
        const data = JSON.parse(result);
        expect(data).to.have.nested.property('content[0].text');
        
        const updateData = JSON.parse(data.content[0].text);
        expect(updateData).to.have.property('state', 'closed');
    });

    after(async () => {
        await githubClient.cleanup();
    });
});
