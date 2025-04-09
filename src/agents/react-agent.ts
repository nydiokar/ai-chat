import { ToolDefinition, ToolResponse } from "../tools/mcp/types/tools.js";
import { Agent, ThoughtProcess } from "../interfaces/agent.js";
import { LLMProvider } from "../interfaces/llm-provider.js";
import { Input, Response } from "../types/common.js";
import { ReActPromptGenerator } from "../prompt/react-prompt-generator.js";
import { MCPContainer } from "../tools/mcp/di/container.js";
import { getLogger } from '../utils/shared-logger.js';
import yaml from 'js-yaml';
import { v4 as uuid } from 'uuid';
import { IToolManager } from "../tools/mcp/interfaces/core.js";
import { MemoryType } from "../interfaces/memory-provider.js";
import { MemoryProvider } from "../interfaces/memory-provider.js";
import type { Logger } from 'winston';

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

/**
 * ReAct Agent that supports both direct responses and reasoning with tools
 * This implementation includes two processing modes:
 * 1. Simple mode for direct tool usage
 * 2. ReAct mode for complex queries requiring multi-step reasoning
 */
export class ReActAgent implements Agent {
    private readonly DEFAULT_MAX_STEPS = 5;
    private readonly logger: Logger;
    public readonly id = uuid();
    public readonly name: string;

    constructor(
        container: MCPContainer, // kept for compatibility with the old structure
        private readonly llmProvider: LLMProvider,
        private readonly memoryProvider: MemoryProvider,
        private readonly toolManager: IToolManager,
        private readonly promptGenerator: ReActPromptGenerator,
        name?: string
    ) {
        this.logger = getLogger('ReActAgent');
        this.name = name || "ReAct Agent";
        this.logger.info('ReAct Agent initialized', { agentId: this.id, agentName: this.name });
    }

    /**
     * Process a message using either simple mode or ReAct reasoning
     */
    async processMessage(message: string, conversationHistory?: Input[]): Promise<Response> {
        this.logger.debug('Processing message in simple mode', { messageLength: message.length });
        return this.processSimple(message, conversationHistory || []);
    }

    /**
     * Simple direct approach - handles both direct responses and single tool executions
     */
    private async processSimple(message: string, history: Input[]): Promise<Response> {
        try {
            // Get tools
            const tools = await this.toolManager.getAvailableTools();
            
            // Generate simple prompt
            const systemPrompt = await this.promptGenerator.generateSimplePrompt();
            this.llmProvider.setSystemPrompt(systemPrompt);
            
            // Generate response with tools enabled
            const response = await this.llmProvider.generateResponse(message, history, tools);
            this.logger.debug('Generated response', { 
                hasToolResults: response.toolResults?.length > 0 
            });

            // If no tool calls, return the response directly
            if (!response.toolResults || response.toolResults.length === 0) {
                return response;
            }

            // Handle tool execution
            const toolCall = response.toolResults[0];
            const toolName = toolCall.metadata?.toolName;
            const toolArgs = toolCall.metadata?.arguments ? JSON.parse(toolCall.metadata.arguments) : {};

            this.logger.debug('Executing tool', { toolName, args: toolArgs });
            
            // Execute the tool
            const result = await this.toolManager.executeTool(toolName, toolArgs);
            
            // Store the result in memory
            await this.memoryProvider.store({
                userId: 'system',
                type: MemoryType.TOOL_USAGE,
                content: result,
                metadata: { toolName }
            });

            // Generate final response based on tool result
            const finalPrompt = `Original request: ${message}\n\nThe tool ${toolName} returned these results:\n${JSON.stringify(result.data || result, null, 2)}\n\nBased on these results, please provide a helpful final response to the user.`;
            
            this.logger.debug('Generating final response with tool results', { finalPrompt });
            
            // Get final response without tools
            const finalResponse = await this.llmProvider.generateResponse(finalPrompt, []);

            // Return combined response with tool results
            return {
                content: finalResponse.content,
                tokenCount: (response.tokenCount || 0) + (finalResponse.tokenCount || 0),
                toolResults: [result]
            };
        } catch (error) {
            this.logger.error('Error in simple processing', { error });
            return {
                content: "I encountered an error processing your request.",
                tokenCount: null,
                toolResults: []
            };
        }
    }

    /**
     * ReAct approach for complex queries
     * This implementation handles a single reasoning step and tool execution
     */
    private async processWithReact(message: string, history: Input[]): Promise<Response> {
        // Create session ID for tracking this interaction
        const sessionId = uuid();
        const userId = history.length > 0 ? `user-${history[0].content.substring(0, 10)}` : 'anonymous';
        
        try {
            // Get tools
            const tools = await this.toolManager.getAvailableTools();
            
            // Generate ReAct prompt
            const systemPrompt = await this.promptGenerator.generateSimplePrompt();
            
            // Set the system prompt on the provider
            this.llmProvider.setSystemPrompt(systemPrompt);
            
            // Start first reasoning step
            this.logger.debug('Starting ReAct reasoning', { sessionId });
            
            // Generate initial response with tools enabled
            const initialResponse = await this.llmProvider.generateResponse(message, history, tools);
            
            // Store in memory
            await this.memoryProvider.store({
                userId,
                type: MemoryType.CONVERSATION,
                content: {
                    input: message,
                    response: initialResponse.content
                },
                metadata: { sessionId, step: 0 }
            });
            
            // If no tool calls, return the response directly
            if (!initialResponse.toolResults || initialResponse.toolResults.length === 0) {
                return initialResponse;
            }
            
            // Process the first tool call
            const toolResult = initialResponse.toolResults[0];
            const toolName = toolResult.metadata?.toolName || '';
            const toolArgs = toolResult.metadata?.arguments 
                ? JSON.parse(toolResult.metadata.arguments) 
                : {};
            
            this.logger.debug('Executing tool call', { tool: toolName, sessionId });
            
            // Execute the tool
            const result = await this.toolManager.executeTool(toolName, toolArgs);
            
            this.logger.debug('Tool execution result', { result });
            
            // Store tool result
            await this.memoryProvider.store({
                userId,
                type: MemoryType.TOOL_USAGE,
                content: result,
                metadata: { sessionId, step: 0, toolName }
            });
            
            // Extract reasoning from the initial response if possible
            const reasoning = this.extractReasoning(initialResponse.content);
            
            // Generate final response based on tool result
            let finalPrompt = `Original request: ${message}\n\n` +
                            `The tool ${toolName} returned these results:\n` +
                            `${JSON.stringify(result, null, 2)}\n\n` +
                            `Based on these results, please provide a helpful final response to the user.`;
            
            this.logger.debug('Final prompt for response generation', { finalPrompt });
            
            // Set system prompt to a simpler version for the final response
            this.llmProvider.setSystemPrompt(await this.promptGenerator.generateSimplePrompt());
            
            // Get final response without tools
            const finalResponse = await this.llmProvider.generateResponse(finalPrompt, []);
            
            this.logger.debug('Final response content', { content: finalResponse.content });
            
            // Store final response
            await this.memoryProvider.store({
                userId,
                type: MemoryType.CONVERSATION,
                content: finalResponse.content,
                metadata: { sessionId, isFinal: true }
            });
            
            // Combine the tool results
            return {
                content: finalResponse.content,
                tokenCount: (initialResponse.tokenCount || 0) + (finalResponse.tokenCount || 0),
                toolResults: [result]
            };
        } catch (error) {
            this.logger.error('Error in ReAct processing', { error, sessionId });
            return {
                content: "I encountered an error processing your request.",
                tokenCount: null,
                toolResults: []
            };
        }
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
            return await this.toolManager.executeTool(tool.name, args);
        } catch (error) {
            this.logger.error('Tool execution error', { 
                tool: tool.name, 
                error 
            });
            
            return { 
                success: false,
                data: null,
                error: error instanceof Error ? error.message : String(error)
            };
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
        // Not tracking thought process in this version
        return null;
    }
}