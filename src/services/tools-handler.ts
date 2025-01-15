import { Tool, Message } from '../types/index.js';
import { AIService } from './ai-service.js';
import { MCPClientService } from './mcp-client-service.js';
import { DatabaseService } from './db-service.js';

interface ToolCall {
    name: string;
    arguments: any;
}

export class ToolsHandler {
    constructor(
        private client: MCPClientService,
        private ai: AIService,
        private db: DatabaseService
    ) {}

    async processQuery(query: string, conversationId: number): Promise<string> {
        const tools = await this.client.listTools();
        const messages: Message[] = [{
            role: 'user',
            content: query,
            conversationId,
            createdAt: new Date(),
            id: 0
        }];
        
        // Initial AI response
        const response = await this.ai.generateResponse(query, messages, tools);
        const toolCalls = this.parseToolCalls(response.content);
        
        let finalText: string[] = [response.content];

        // Handle tool calls
        for (const call of toolCalls) {
            const startTime = Date.now();
            try {
                const result = await this.client.callTool(call.name, call.arguments);
                
                // Log successful tool usage
                await this.db.executePrismaOperation(prisma => 
                    prisma.mCPToolUsage.create({
                        data: {
                            toolId: call.name,
                            conversationId,
                            input: call.arguments,
                            output: result,
                            duration: Date.now() - startTime,
                            status: 'success'
                        }
                    })
                );

                finalText.push(result);
                
                // Continue conversation with tool result
                messages.push(
                    { role: 'assistant', content: response.content, id: 0, createdAt: new Date(), conversationId },
                    { role: 'user', content: result, id: 0, createdAt: new Date(), conversationId }
                );
                
                const followUp = await this.ai.generateResponse('', messages);
                finalText.push(followUp.content);
                
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                
                // Log failed tool usage
                await this.db.executePrismaOperation(prisma => 
                    prisma.mCPToolUsage.create({
                        data: {
                            toolId: call.name,
                            conversationId,
                            input: call.arguments,
                            error: errorMsg,
                            duration: Date.now() - startTime,
                            status: 'error'
                        }
                    })
                );
                
                finalText.push(`Error executing tool ${call.name}: ${errorMsg}`);
            }
        }

        return finalText.join('\n');
    }

    public parseToolCalls(content: string): ToolCall[] {
        const toolCallRegex = /\[Calling tool (.*?) with args (.*?)\]/g;
        const matches = [...content.matchAll(toolCallRegex)];
        return matches.map(match => ({
            name: match[1],
            arguments: JSON.parse(match[2])
        }));
    }
} 