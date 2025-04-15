import { ToolDefinition, ToolResponse } from "../tools/mcp/types/tools.js";
import { Agent } from "../interfaces/base-agent.js";
import { Input, Response } from "../types/common.js";
import { MemoryType } from "../interfaces/memory-provider.js";
import { getLogger } from '../utils/shared-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ReasoningStep } from '../interfaces/react-types.js';
import { ReActEngine } from './react-engine.js';
import type { Logger } from 'winston';
import { MCPContainer } from "../tools/mcp/di/container.js";

/**
 * ReAct Agent that implements the Agent interface
 * A lightweight wrapper around the ReActEngine that handles the ReAct reasoning pattern
 */
export class ReActAgent implements Agent {
    readonly id: string;
    readonly name: string;
    
    private readonly logger: Logger;
    private readonly engine: ReActEngine;
    private debugMode: boolean = false;
    private lastReasoningStep: ReasoningStep | null = null;
    private userId: string = 'default-user'; // Default user ID
    
    /**
     * Create a new ReActAgent
     * @param engine The ReAct engine that will handle the reasoning process
     * @param name Optional name for the agent (defaults to "ReAct Agent")
     */
    constructor(
        engine: ReActEngine,
        name: string = "ReAct Agent"
    ) {
        this.id = uuidv4();
        this.name = name;
        this.logger = getLogger(`ReActAgent:${name}`);
        this.engine = engine;
        
        this.logger.info('ReAct Agent initialized', {
            agentId: this.id,
            name: this.name
        });
    }
    
    /**
     * Set the user ID for this agent session
     * Useful for memory persistence and per-user customization
     */
    setUserId(userId: string): void {
        if (userId && userId.trim()) {
            this.userId = userId.trim();
        }
    }
    
    /**
     * Process a user message using ReAct reasoning
     * Delegates the actual processing to the ReActEngine
     */
    async processMessage(message: string, conversationHistory: Input[] = []): Promise<Response> {
        this.logger.info('Processing message with ReAct agent', { 
            message,
            userId: this.userId,
            historyLength: conversationHistory.length
        });
        
        // Clear context before processing new message
        this.clearContext();
        
        try {
            // Delegate processing to the ReActEngine
            const finalAnswer = await this.engine.process(message, this.userId);
            
            // After processing, update the last reasoning step for debugging
            try {
                const lastStep = await this.engine.getLastReasoningStep(this.userId);
                if (lastStep) {
                    this.lastReasoningStep = lastStep;
                }
            } catch (error) {
                this.logger.warn('Failed to retrieve last reasoning step', { 
                    error: error instanceof Error ? error.message : String(error) 
                });
            }
            
            return {
                content: finalAnswer,
                tokenCount: null, // We don't track tokens in this implementation
                toolResults: []
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.error('Error processing message with ReAct agent', { error: errorMsg });
            
            return {
                content: "I'm sorry, I encountered an error while processing your request. Could you please try again or rephrase your request?",
                tokenCount: null,
                toolResults: []
            };
        }
    }
    
    /**
     * Execute a tool directly
     * Delegates to the engine's tool execution functionality
     */
    async executeTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<ToolResponse> {
        this.logger.info('Executing tool directly', { tool: tool.name, args });
        
        try {
            // Delegate tool execution to the engine
            const result = await this.engine.executeToolDirectly(tool.name, args);
            
            return {
                success: true,
                data: result,
                metadata: {
                    toolName: tool.name
                }
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.logger.error('Error executing tool', { tool: tool.name, error: errorMsg });
            
            return {
                success: false,
                data: null,
                error: errorMsg
            };
        }
    }
    
    /**
     * Clear any contextual state
     * Called before processing a new message to ensure a clean state
     */
    private clearContext(): void {
        this.lastReasoningStep = null;
    }
    
    /**
     * Clean up resources used by the agent
     */
    async cleanup(): Promise<void> {
        // Nothing specific to clean up
        this.logger.debug('Cleaning up ReAct agent resources');
    }
    
    /**
     * Set debug mode
     */
    setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
        this.logger.info('Debug mode set', { enabled });
    }
    
    /**
     * Get the last reasoning step for debugging
     * Direct access to the ReasoningStep without conversion
     */
    getLastThoughtProcess(): ReasoningStep | null {
        return this.lastReasoningStep;
    }
}