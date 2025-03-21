import { ToolDefinition } from "./tools/mcp/types/tools.js";
import { IToolManager } from "./tools/mcp/interfaces/core.js";

export class SystemPromptGenerator {
    private readonly defaultIdentity = `You are an intelligent AI assistant. You have access to various tools to help users. When using tools:
1. Always use tools when they would help complete the user's request
2. You can use multiple tools in sequence if needed
3. Always respond to the user after using tools
4. If a tool fails, try an alternative approach or explain the issue to the user`;

    // Tool categories for lazy loading
    private readonly toolCategories = {
        github: [
            'create_repository', 'push_files', 'create_pull_request', 'create_issue',
            'search_repositories', 'search_code', 'search_issues', 'get_file_contents',
            'fork_repository', 'create_branch', 'list_commits', 'list_issues',
            'update_issue', 'add_issue_comment', 'get_issue', 'search_users'
        ],
        search: [
            'brave_web_search', 'brave_local_search', 'deep_research',
            'parallel_search', 'visit_page'
        ],
        file: [
            'create_or_update_file'
        ]
    };

    constructor(private toolProvider: IToolManager) {}

    async generatePrompt(systemPrompt: string = "", message: string = ""): Promise<string> {
        const tools = await this.getRelevantTools(message);
        
        const promptParts = [
            systemPrompt || this.defaultIdentity
        ];

        if (tools.length > 0) {
            promptParts.push(
                "\nAvailable Tools:",
                ...tools.map(tool => this.formatToolInfo(tool))
            );
        }

        return promptParts.join("\n\n");
    }

    private formatToolInfo(tool: ToolDefinition): string {
        const parts = [
            `Tool: ${tool.name}`,
            `Purpose: ${tool.description}`,
            `When to use: Use this tool when the user's request involves ${tool.name.split('_').join(' ')}`
        ];

        if (tool.parameters && tool.parameters.length > 0) {
            parts.push('Parameters:');
            tool.parameters.forEach(param => {
                const required = param.required ? ' (required)' : '';
                parts.push(`- ${param.name}${required}: ${param.description || 'No description'}`);
            });
        }

        return parts.join('\n');
    }

    public async getRelevantTools(message: string): Promise<ToolDefinition[]> {
        // Get all available tools
        const allTools = await this.toolProvider.getAvailableTools();
        
        // If no message, return all tools (changed from returning none)
        if (!message.trim()) {
            return allTools;
        }

        // Convert message to lowercase for easier matching
        const msg = message.toLowerCase();

        // Determine which categories of tools to include
        const neededCategories = new Set<keyof typeof this.toolCategories>();

        // GitHub-related keywords
        if (msg.includes('github') || msg.includes('repo') || msg.includes('pull request') || 
            msg.includes('issue') || msg.includes('commit') || msg.includes('branch')) {
            neededCategories.add('github');
        }

        // Search-related keywords
        if (msg.includes('search') || msg.includes('find') || msg.includes('look up') || 
            msg.includes('research') || msg.includes('explore') || msg.includes('what') || 
            msg.includes('how') || msg.includes('why') || msg.includes('when') || 
            msg.includes('where') || msg.includes('who')) {
            neededCategories.add('search');
        }

        // File-related keywords
        if (msg.includes('file') || msg.includes('create') || msg.includes('update') || 
            msg.includes('write') || msg.includes('read') || msg.includes('edit')) {
            neededCategories.add('file');
        }

        // If no categories matched, return all tools (changed from returning none)
        if (neededCategories.size === 0) {
            return allTools;
        }

        // Get the tool names we want
        const neededToolNames = new Set(
            Array.from(neededCategories).flatMap(cat => this.toolCategories[cat])
        );

        // Filter the available tools to only include the ones we need
        return allTools.filter(tool => neededToolNames.has(tool.name));
    }
}
