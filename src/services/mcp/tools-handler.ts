import { Message } from '../../types/index.js';
import { AIService } from '../ai/base-service.js';
import { MCPClientService } from './mcp-client-service.js';
import { DatabaseService } from '../db-service.js';
import { MCPError } from '../../types/errors.js';

export class ToolsHandler {
    private availableTools: Set<string>;

    constructor(
        private client: MCPClientService,
        private ai: AIService,
        private db: DatabaseService
    ) {
        this.availableTools = new Set();
        this.initializeTools();
    }

    private async initializeTools() {
        try {
            console.log('[ToolsHandler] Initializing tools...');
            const tools = await this.client.listTools();
            this.availableTools = new Set(tools.map(tool => tool.name));
            console.log(`[ToolsHandler] Initialized ${tools.length} tools:`, Array.from(this.availableTools));
        } catch (error) {
            console.error('[ToolsHandler] Failed to initialize tools:', error);
        }
    }

    async processQuery(query: string, conversationId: number): Promise<string> {
        // Ensure tools are initialized
        if (this.availableTools.size === 0) {
            console.log('[ToolsHandler] No tools available, attempting to initialize...');
            await this.initializeTools();
            
            // Double check tools were initialized
            if (this.availableTools.size === 0) {
                console.warn('[ToolsHandler] Still no tools available after initialization');
                return "I apologize, but I'm currently unable to access my tools. Please try again in a moment.";
            }
        }

        console.log(`[ToolsHandler] Processing query: ${query}`);
        
        // Try both formats
        const toolMatch = 
            // Format 1: [Calling tool tool-name with args json-args]
            query.match(/\[Calling tool (\S+) with args ({[^}]+})\]/) ||
            // Format 2: Use tool-name with parameter 'json-args'
            query.match(/Use (\S+) with parameter '({[^}]+})'/);

        // For error handling, also match just the tool name in "Use tool-name"
        const errorMatch = !toolMatch && query.match(/Use (\S+)/);
        if (errorMatch) {
            const [_, toolName] = errorMatch;
            if (!this.availableTools.has(toolName)) {
                throw MCPError.toolNotFound(toolName);
            }
        }
        
        if (toolMatch) {
            const [_, toolName, argsStr] = toolMatch;
            console.log(`[ToolsHandler] Matched tool command: ${toolName}`);
            
            if (!this.availableTools.has(toolName)) {
                console.warn(`[ToolsHandler] Tool not found: ${toolName}`);
                console.log(`[ToolsHandler] Available tools:`, Array.from(this.availableTools));
                throw MCPError.toolNotFound(toolName);
            }

            try {
                console.log(`[ToolsHandler] Executing tool ${toolName} with args: ${argsStr}`);
                const args = JSON.parse(argsStr);
                const result = await this.client.callTool(toolName, args);
                console.log(`[ToolsHandler] Tool execution successful`);
                
                await this.db.executePrismaOperation(prisma => 
                    prisma.mCPToolUsage.create({
                        data: {
                            toolId: toolName,
                            conversationId,
                            input: args,
                            output: result,
                            duration: 0,
                            status: 'success'
                        }
                    })
                );

                await this.db.addMessage(conversationId, result, 'assistant');
                return result;
            } catch (error) {
                throw MCPError.toolExecutionFailed(error);
            }
        }

        // Default AI handling
        const messages: Message[] = [{
            role: 'user',
            content: query,
            conversationId,
            createdAt: new Date(),
            id: 0
        }];
        
        const response = await this.ai.generateResponse(query, messages);
        await this.db.addMessage(conversationId, response.content, 'assistant');
        return response.content;
    }
}
