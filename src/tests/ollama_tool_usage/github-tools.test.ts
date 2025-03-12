import { expect } from 'chai';
import { MCPClientService } from "../../tools/mcp/mcp-client-service.js";
import { ToolDefinition } from "../../tools/mcp/migration/types/tools.js";
import mcpServers from '../../tools/mcp/mcp_config.js';

// Custom test logger
function logTest(action: string, details?: any) {
    const logMessage = {
        test: 'GitHub Tools',
        action,
        ...(details && { details: filterTestDetails(details) })
    };
    console.log(JSON.stringify(logMessage));
}

// Filter out unnecessary details from GitHub responses
function filterTestDetails(details: any) {
    if (typeof details === 'string') {
        try {
            details = JSON.parse(details);
        } catch {
            return details;
        }
    }
    
    // For GitHub API responses, only keep essential fields
    if (details.content?.[0]?.text) {
        const data = JSON.parse(details.content[0].text);
        return {
            id: data.id,
            number: data.number,
            state: data.state,
            title: data.title
        };
    }
    return details;
}

describe('GitHub MCP Tools', function() {
    this.timeout(30000);
    let githubClient: MCPClientService;

    before(async function() {
        githubClient = new MCPClientService(mcpServers.mcpServers["github"]);
        await githubClient.initialize();
    });

    it('should list available GitHub tools', async () => {
        const tools = await githubClient.listTools();
        logTest('list_tools', tools.map((t: ToolDefinition) => t.name));
        expect(tools).to.be.an('array').that.is.not.empty;
    });

    it('should create a new issue', async () => {
        const result = await githubClient.callTool('create_issue', {
            owner: 'nydiokar',
            repo: 'ai-chat',
            title: 'Test Issue from GitHub Tools Test',
            body: 'This is a test issue created to verify GitHub tool functionality.'
        });
        
        logTest('create_issue', result);
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

        logTest('add_comment', result);
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

        logTest('close_issue', result);
        const data = JSON.parse(result);
        expect(data).to.have.nested.property('content[0].text');
        
        const updateData = JSON.parse(data.content[0].text);
        expect(updateData).to.have.property('state', 'closed');
    });

    after(async () => {
        await githubClient.cleanup();
    });
});
