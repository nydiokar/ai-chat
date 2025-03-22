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

    async generatePrompt(systemPrompt: string = "", message: string = ""): Promise<string> {
        const tools = await this.getTools(message);
        
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

        if (tools.length > 0) {
            promptParts.push(
                "\nAvailable Tools:",
                ...tools.map(tool => this.formatToolInfo(tool))
            );
        }

        const finalPrompt = promptParts.join("\n\n");
        
        // Log approximate token count for debugging
        console.log(`System prompt with tools size: ${finalPrompt.length} characters (rough estimate: ${Math.floor(finalPrompt.length/4)} tokens)`);
        console.log(`Number of tools included in prompt: ${tools.length}`);
        
        return finalPrompt;
    }

    private formatToolInfo(tool: ToolDefinition): string {
        const parts = [
            `Tool: ${tool.name}`,
            `Purpose: ${tool.description}`
        ];

        if (tool.parameters && tool.parameters.length > 0) {
            parts.push('Parameters:');
            tool.parameters.forEach(param => {
                const required = param.required ? ' (REQUIRED)' : ' (optional)';
                parts.push(`- ${param.name}${required}: ${param.description || 'No description'}`);
            });
        }

        return parts.join('\n');
    }

    public async getTools(message: string): Promise<ToolDefinition[]> {
        // Get all available tools
        const allTools = await this.toolProvider.getAvailableTools();
        
        // Skip tools for empty messages
        if (!message.trim()) {
            console.log("Empty message, returning no tools");
            return [];
        }
        
        // Skip tools for very simple messages (just basic greetings)
        if (this.isBasicGreeting(message)) {
            console.log("Simple greeting detected, returning no tools");
            return [];
        }

        // Prioritize search tools by placing them first
        const prioritizedTools = this.prioritizeTools(allTools, message);
        
        console.log(`Using all ${prioritizedTools.length} available tools`);
        return prioritizedTools;
    }

    private prioritizeTools(tools: ToolDefinition[], message: string): ToolDefinition[] {
        // Check if message contains search-related terms
        const isSearchQuery = /search|find|look up|news|information|web|brave/i.test(message);
        
        if (isSearchQuery) {
            // Put brave search and web search tools first
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
            
            return [...searchTools, ...otherTools];
        }
        
        return tools;
    }

    // Simple helper to detect basic greetings that don't need tools
    private isBasicGreeting(message: string): boolean {
        const lowerMessage = message.trim().toLowerCase();
        return /^(hi|hello|hey|thanks|thank you)$/i.test(lowerMessage);
    }
}
