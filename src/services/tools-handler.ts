import { Message } from '../types/index.js';
import { AIService } from './ai-service.js';
import { MCPClientService } from './mcp-client-service.js';
import { DatabaseService } from './db-service.js';
import toolsConfig from '../config/tools.js';
import { MCPError } from '../types/errors.js';

export class ToolsHandler {
    private availableTools: Set<string>;

    constructor(
        private client: MCPClientService,
        private ai: AIService,
        private db: DatabaseService
    ) {
        // Initialize available tools from config
        this.availableTools = new Set(toolsConfig.tools.map(tool => tool.name));
    }

    async processQuery(query: string, conversationId: number): Promise<string> {
        // Parse tool usage command: "Use tool-name with parameter 'value'"
        const toolMatch = query.match(/^Use (\S+)(?:\s+with parameter '([^']+)')?$/);
        
        if (toolMatch) {
            const [_, toolName, param] = toolMatch;
            
            if (!this.availableTools.has(toolName)) {
                throw MCPError.toolNotFound(toolName);
            }

            if (!param) {
                throw MCPError.missingParameter(toolName);
            }

            try {
                const result = await this.client.callTool(toolName, { param });
                
                await this.db.executePrismaOperation(prisma => 
                    prisma.mCPToolUsage.create({
                        data: {
                            toolId: toolName,
                            conversationId,
                            input: { param },
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
        const tools = await this.client.listTools();
        const messages: Message[] = [{
            role: 'user',
            content: query,
            conversationId,
            createdAt: new Date(),
            id: 0
        }];
        
        const response = await this.ai.generateResponse(query, messages, tools);
        await this.db.addMessage(conversationId, response.content, 'assistant');
        return response.content;
    }
} 