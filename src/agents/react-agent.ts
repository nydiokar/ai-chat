import { v4 as uuid } from 'uuid';
import { Agent, ThoughtProcess } from '../interfaces/agent.js';
import { Input, Response } from '../types/common.js';
import { LLMProvider } from '../interfaces/llm-provider.js';
import { MemoryProvider, MemoryType } from '../interfaces/memory-provider.js';
import { IToolManager } from '../tools/mcp/interfaces/core.js';
import { ReActPromptGenerator } from '../prompt/react-prompt-generator.js';
import { MCPContainer } from '../tools/mcp/di/container.js';
import Logger from '../utils/shared-logger.js';
import yaml from 'js-yaml';
import { ToolDefinition, ToolResponse } from '../tools/mcp/types/tools.js';

// Implement the ReAct thought process interfaces based on documentation
interface ReActThought {
    thought?: string;
    reasoning?: string;
    plan?: string;
}

interface ReActAction {
    tool: string;
    purpose?: string;
    params: Record<string, any>;
}

interface ReActObservation {
    result: string | any;
}

interface ReActNextStep {
    plan?: string;
}

/**
 * Complete definition of a ReAct workflow step
 */
interface ReActStep {
    thought?: ReActThought;
    action?: ReActAction;
    observation?: ReActObservation;
    next_step?: ReActNextStep;
}

interface ToolExecutionResult {
    toolName: string;
    result: any;
    timestamp: string;
}

interface AgentContext {
    toolResults?: ToolExecutionResult[];
}

/**
 * ReAct Agent that supports both direct responses and reasoning with tools
 * This implementation includes two processing modes:
 * 1. Simple mode for direct tool usage
 * 2. ReAct mode for complex queries requiring multi-step reasoning
 */
export class ReActAgent implements Agent {
    private readonly DEFAULT_MAX_STEPS = 5;
    public readonly id = uuid();
    public readonly name: string;
    private readonly logger = Logger;
    private currentContext: AgentContext = {};
    private lastThoughtProcess: ThoughtProcess | null = null;

    constructor(
        private container: MCPContainer,
        private llmProvider: LLMProvider,
        private memoryProvider: MemoryProvider,
        private toolManager: IToolManager,
        private promptGenerator: ReActPromptGenerator
    ) {
        this.name = "ReAct Agent";
        this.logger.info('ReAct Agent initialized', { agentId: this.id, agentName: this.name });
    }

    private clearContext() {
        this.currentContext = {};
        this.logger.debug('Cleared agent context');
    }

    /**
     * Process a message using either simple mode or ReAct reasoning
     */
    async processMessage(message: string, conversationHistory: Input[] = []): Promise<Response> {
        // Clear context at the start of each new request
        this.clearContext();
        
        try {
            // First try simple mode
            return await this.processSimple(message, conversationHistory);
        } catch (error) {
            this.logger.error('Error in simple mode, falling back to ReAct', { error });
            // If simple mode fails, try ReAct mode
            return await this.processWithReact(message, conversationHistory);
        }
    }

    /**
     * Simple direct approach - handles both direct responses and single tool executions
     */
    private async processSimple(message: string, history: Input[]): Promise<Response> {
        try {
            // Get tools
            const tools = await this.toolManager.getAvailableTools();
            
            // Generate prompt using the standard method
            const prompt = await this.promptGenerator.generatePrompt(message, tools, history);
            await this.llmProvider.setSystemPrompt(prompt);
            
            // Get response
            return await this.llmProvider.generateResponse(message);
        } catch (error) {
            this.logger.error('Error in simple mode', { error });
            throw error;
        }
    }

    /**
     * ReAct approach for complex queries
     * This implementation handles a single reasoning step and tool execution
     */
    private async processWithReact(message: string, history: Input[]): Promise<Response> {
        this.logger.debug('Processing message with ReAct', { messageLength: message.length });
        
        // Get tools and generate prompt
        const tools = await this.toolManager.getAvailableTools();
        const prompt = await this.promptGenerator.generatePrompt(message, tools, history);
        await this.llmProvider.setSystemPrompt(prompt);
        
        let response = await this.llmProvider.generateResponse(message);
        
        // If there are tool results in the context, include them in the response
        const toolResults = this.currentContext.toolResults;
        if (toolResults && toolResults.length > 0) {
            const toolResponses = toolResults.map(result => ({
                success: true,
                data: result.result,
                metadata: {
                    toolName: result.toolName,
                    timestamp: result.timestamp
                }
            }));
            
            response = {
                ...response,
                toolResults: toolResponses
            };
        }
        
        return response;
    }
    
    /**
     * Determine if a query is complex enough to warrant ReAct mode
     */
    private isComplexQuery(message: string): boolean {
        // Simple heuristic - improve as needed
        const complexPatterns = [
            /search|find|research/i,
            /explain|analyze|compare/i,
            /github|repository|issue/i,
            /\?.*\?/i, // Multiple questions
            /step.*by.*step/i,
            /create.*plan/i
        ];
        
        return message.length > 100 || 
            complexPatterns.some(pattern => pattern.test(message));
    }
    
    /**
     * Extract reasoning from a response
     */
    private extractReasoning(response: string): string {
        // Try to find YAML blocks with reasoning
        const yamlMatch = response.match(/```(?:yaml)?\s*([\s\S]*?)```/);
        if (yamlMatch) {
            const yamlContent = yamlMatch[1];
            const reasoningMatch = yamlContent.match(/thought:[\s\S]*?reasoning:\s*"([^"]+)"/);
            if (reasoningMatch && reasoningMatch[1]) {
                return reasoningMatch[1];
            }
        }
        
        // If no structured reasoning found, return a portion of the response
        return response.substring(0, 200) + (response.length > 200 ? '...' : '');
    }

    /**
     * Execute a tool directly - required by Agent interface
     */
    async executeTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<ToolResponse> {
        try {
            const result = await this.toolManager.executeTool(tool.name, args);
            
            if (result.success) {
                // Initialize toolResults array if it doesn't exist
                if (!this.currentContext.toolResults) {
                    this.currentContext.toolResults = [];
                }
                
                this.currentContext.toolResults.push({
                    toolName: tool.name,
                    result: result.data,
                    timestamp: new Date().toISOString()
                });
            }
            
            return result;
        } catch (error) {
            this.logger.error('Tool execution failed', { toolName: tool.name, error });
            throw error;
        }
    }

    /**
     * Clean up resources - required by Agent interface
     */
    async cleanup(): Promise<void> {
        // Nothing to clean up in this implementation
    }

    /**
     * Enable/disable debug mode - required by Agent interface
     */
    setDebugMode(enabled: boolean): void {
        // Debug mode not implemented in this version
    }

    /**
     * Get the last thought process - required by Agent interface
     */
    getLastThoughtProcess(): ThoughtProcess | null {
        return this.lastThoughtProcess;
    }
}