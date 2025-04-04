import { ToolDefinition } from "./tools/mcp/types/tools.js";
import { IToolManager } from "./tools/mcp/interfaces/core.js";

export class SystemPromptGenerator {
    private readonly defaultIdentity = `You are an intelligent AI assistant with access to external tools to help users. Always respond directly unless a tool would clearly help solve the user's request.

When using tools:
1. Always use tools when they would help complete the user's request
2. You can use multiple tools in sequence if needed
3. Always respond to the user with the results of the tool after using it
4. If a tool fails, try an alternative approach or explain the issue to the user`;

    constructor(private toolProvider: IToolManager) {}

    async generatePrompt(systemPrompt: string = ""): Promise<string> {
        // Get current date and time information
        const now = new Date();
        const currentDate = now.toDateString();
        const currentTime = now.toTimeString().split(' ')[0];
        const currentYear = now.getFullYear();
        const currentMonth = now.toLocaleString('default', { month: 'long' });
        const currentDay = now.getDate();
        
        const promptParts = [
            systemPrompt || this.defaultIdentity,
            // Add current date/time information
            `Current date: ${currentDate}`,
            `Current time: ${currentTime}`,
            `Current year: ${currentYear}`,
            `Current month: ${currentMonth}`,
            `Current day: ${currentDay}`
        ];

        return promptParts.join("\n\n");
    }

    public async getTools(message: string): Promise<ToolDefinition[]> {
        // Skip expensive operations for empty or basic messages
        if (!message.trim() || this.isBasicGreeting(message)) {
            return [];
        }
        
        // Get all available tools
        const allTools = await this.toolProvider.getAvailableTools();
        
        // Check if message contains search-related terms
        const isSearchQuery = /search|find|look up|news|information|web|brave/i.test(message);
        
        // For search queries, prioritize search tools
        if (isSearchQuery) {
            return this.prioritizeSearchTools(allTools);
        }
        
        // For non-search queries, return all tools
        return allTools;
    }

    private prioritizeSearchTools(tools: ToolDefinition[]): ToolDefinition[] {
        // Separate search tools from other tools
        const searchTools: ToolDefinition[] = [];
        const otherTools: ToolDefinition[] = [];
        
        tools.forEach(tool => {
            // Prioritize Brave and other search tools
            if (tool.name.includes('brave') || 
                tool.name.includes('search') || 
                tool.name.includes('research') ||
                tool.name.includes('visit_page')) {
                searchTools.push(tool);
            } else {
                otherTools.push(tool);
            }
        });
        
        // Return search tools first, then other tools
        return [...searchTools, ...otherTools];
    }

    // Simple helper to detect basic greetings that don't need tools
    private isBasicGreeting(message: string): boolean {
        const lowerMessage = message.trim().toLowerCase();
        return /^(hi|hello|hey|thanks|thank you)$/i.test(lowerMessage);
    }
}
