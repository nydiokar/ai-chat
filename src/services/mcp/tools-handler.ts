import { Message, MCPToolContext, MCPToolUsageHistory } from '../../types/index.js';
import { AIService } from '../ai/base-service.js';
import { MCPClientService } from './mcp-client-service.js';
import { DatabaseService } from '../db-service.js';
import { MCPError } from '../../types/errors.js';
import { ToolWithUsage } from '../../types/mcp-config.js';

export class ToolsHandler {
    private availableTools: Set<string>;
    private toolContexts: Map<string, MCPToolContext> = new Map();

    constructor(
        private client: MCPClientService,
        private ai: AIService,
        private db: DatabaseService
    ) {
        this.availableTools = new Set();
        this.toolContexts = new Map();
        this.initializeTools();
        // Clear old contexts first
        this.clearOldContexts().then(() => this.loadPersistedContexts());
    }

    private async loadPersistedContexts(): Promise<void> {
        try {
            type DBContext = {
                tool: { name: string };
                contextData: any;
                lastRefreshed: Date;
                refreshCount: number;
            };

            const contexts = await this.db.executePrismaOperation(async (prisma) => {
                const result = await prisma.$queryRaw`
                    SELECT c.*, t.name as toolName 
                    FROM MCPToolContext c
                    JOIN MCPTool t ON t.id = c.toolId
                `;
                return result as DBContext[];
            });

            for (const context of contexts) {
                this.toolContexts.set(context.tool.name, {
                    ...context.contextData,
                    lastRefreshed: context.lastRefreshed,
                    refreshCount: context.refreshCount
                });
            }
            console.log(`[ToolsHandler] Loaded ${contexts.length} persisted tool contexts`);
        } catch (error) {
            console.error('[ToolsHandler] Failed to load persisted contexts:', error);
        }
    }

    public async getToolContext(toolName: string): Promise<MCPToolContext | undefined> {
        if (!this.availableTools.has(toolName)) {
            return undefined;
        }
        return this.toolContexts.get(toolName);
    }

    private async getEnhancedContext(toolName: string, currentArgs: any): Promise<MCPToolContext> {
        let context = this.toolContexts.get(toolName) || {
            lastRefreshed: new Date(),
            refreshCount: 0,
            history: []
        };

        type PrismaTool = {
            id: string;
            name: string;
            description: string;
            usage: Array<{
                input: any;
                output: string;
                createdAt: Date;
                status: string;
            }>;
        };

        const tool = await this.db.executePrismaOperation(prisma =>
            prisma.mCPTool.findFirst({
                where: { name: toolName },
                include: {
                    usage: {
                        orderBy: { createdAt: 'desc' },
                        take: 5
                    }
                }
            })
        ) as PrismaTool | null ?? { id: '', name: '', description: '', usage: [] };

        if (tool) {
            const recentUsage = tool.usage.map((u) => ({
                args: u.input,
                result: u.output,
                timestamp: u.createdAt,
                success: u.status === 'success'
            }));

            context = {
                ...context,
                history: recentUsage,
                currentArgs,
                successRate: tool.usage.filter((u) => u.status === 'success').length / tool.usage.length
            };
        }

        return context;
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

    async refreshToolContext(toolName: string, tool: ToolWithUsage): Promise<void> {
        if (!this.availableTools.has(toolName)) {
            throw new Error(`Tool ${toolName} not found`);
        }

        // Generate new context with usage patterns
        const context = {
            lastRefreshed: new Date(),
            refreshCount: (this.toolContexts.get(toolName)?.refreshCount || 0) + 1,
            history: tool.usage.map((u) => ({
                args: u.input,
                result: u.output,
                timestamp: u.createdAt,
                success: u.status === 'success'
            } as MCPToolUsageHistory)),
            patterns: await this.analyzeUsagePatterns(tool.id)
        };

        // Update in-memory context
        this.toolContexts.set(toolName, context);

        // Persist context to database
        await this.db.executePrismaOperation(prisma =>
            prisma.$executeRaw`
                INSERT OR REPLACE INTO MCPToolContext (toolId, contextData, lastRefreshed, refreshCount)
                VALUES (${tool.id}, ${JSON.stringify(context)}, ${context.lastRefreshed}, ${context.refreshCount})
            `
        );

        console.log(`[ToolsHandler] Refreshed and persisted context for tool ${toolName}`);
    }

    private async analyzeUsagePatterns(toolId: string): Promise<any> {
        const usage = await this.db.executePrismaOperation(prisma =>
            prisma.mCPToolUsage.findMany({
                where: {
                    toolId,
                    status: 'success'
                },
                orderBy: { createdAt: 'desc' },
                take: 20
            })
        );

        // Analyze common input patterns
        const inputPatterns = usage.reduce((acc, u) => {
            const inputKeys = Object.keys(u.input as object);
            inputKeys.forEach(key => {
                if (!acc[key]) acc[key] = [];
                acc[key].push((u.input as any)[key]);
            });
            return acc;
        }, {} as Record<string, any[]>);

        // Calculate frequency of values for each input parameter
        const patterns = Object.entries(inputPatterns).reduce((acc, [key, values]) => {
            const frequency = values.reduce((freq, val) => {
                const strVal = JSON.stringify(val);
                freq[strVal] = (freq[strVal] || 0) + 1;
                return freq;
            }, {} as Record<string, number>);

            acc[key] = {
                mostCommon: Object.entries(frequency)
                    .sort(([,a], [,b]) => (b as number) - (a as number))
                    .slice(0, 3)
                    .map(([val]) => JSON.parse(val)),
                uniqueValues: new Set(values.map(v => JSON.stringify(v))).size
            };
            return acc;
        }, {} as Record<string, { mostCommon: any[]; uniqueValues: number }>);

        return patterns;
    }

    async processQuery(query: string, conversationId: number): Promise<string> {
        // Ensure tools are initialized
        if (this.availableTools.size === 0) {
            console.log('[ToolsHandler] No tools available, attempting to initialize...');
            await this.initializeTools();
            
            if (this.availableTools.size === 0) {
                console.warn('[ToolsHandler] Still no tools available after initialization');
                return "I apologize, but I'm currently unable to access my tools. Please try again in a moment.";
            }
        }

        // Add stricter validation for GitHub-related queries
        if (query.toLowerCase().includes('github')) {
            const githubCommands = ['issues', 'pulls', 'repos', 'users', 'commits'];
            const hasValidCommand = githubCommands.some(cmd => query.toLowerCase().includes(cmd));
            
            if (!hasValidCommand) {
                return `I apologize, but I need more specific parameters for GitHub queries. Please specify what you're looking for:
                - For issues: Include 'issues' in your query
                - For pull requests: Include 'pulls' in your query
                - For repositories: Include 'repos' in your query
                - For users: Include 'users' in your query
                - For commits: Include 'commits' in your query`;
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
                
                // Get enhanced context for this tool execution
                const enhancedContext = await this.getEnhancedContext(toolName, args);
                
                // Pass enhanced context to the tool
                const result = await this.client.callTool(toolName, args, enhancedContext);
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

    private async clearOldContexts(): Promise<void> {
        try {
            await this.db.executePrismaOperation(async (prisma) => {
                await prisma.$executeRaw`
                    DELETE FROM MCPToolContext 
                    WHERE lastRefreshed < datetime('now', '-1 day')
                `;
            });
        } catch (error) {
            console.error('[ToolsHandler] Failed to clear old contexts:', error);
        }
    }
}
