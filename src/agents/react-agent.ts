import { ToolDefinition, ToolResponse } from "../tools/mcp/types/tools.js";
import { Agent } from "../interfaces/base-agent.js";
import { Input, Response } from "../types/common.js";
import { getLogger } from '../utils/shared-logger.js';
import { v4 as uuidv4 } from 'uuid';
import { ReasoningStep } from '../interfaces/react-types.js';
import { ReActEngine } from './react-engine.js';
import type { Logger } from 'winston';
import { LLMProvider } from '../interfaces/llm-provider.js';
import { PromptGenerator } from '../interfaces/prompt-generator.js';

export interface AgentConfig {
    userId: string;
    debugMode: boolean;
}

export interface AgentState {
    readonly id: string;
    readonly name: string;
    readonly config: AgentConfig;
    readonly lastReasoningStep: ReasoningStep | null;
}

/**
 * ReAct Agent that implements the Agent interface
 * A lightweight wrapper around the ReActEngine that handles the ReAct reasoning pattern
 */
export class ReActAgent implements Agent {
    private readonly logger: Logger;
    private readonly engine: ReActEngine;
    private readonly llmProvider: LLMProvider;
    private readonly promptGenerator: PromptGenerator;
    private readonly state: AgentState;
    private lastReasoningStep: ReasoningStep | null = null;

    /**
     * Create a new ReActAgent
     * @param engine The ReAct engine that will handle the reasoning process
     * @param llmProvider The LLM provider for direct interactions
     * @param promptGenerator The prompt generator for creating prompts
     * @param name Optional name for the agent (defaults to "ReAct Agent")
     * @param config Optional configuration for the agent
     */
    constructor(
        engine: ReActEngine,
        llmProvider: LLMProvider,
        promptGenerator: PromptGenerator,
        name: string = "ReAct Agent",
        config: Partial<AgentConfig> = {},
    ) {
        this.engine = engine;
        this.llmProvider = llmProvider;
        this.promptGenerator = promptGenerator;
        this.logger = getLogger(`ReActAgent:${name}`);
        
        this.state = {
            id: uuidv4(),
            name,
            config: {
                userId: config.userId ?? 'default-user',
                debugMode: config.debugMode ?? false
            },
            lastReasoningStep: null
        };
        
        this.logger.info('ReAct Agent initialized', {
            agentId: this.state.id,
            name: this.state.name,
            config: this.state.config
        });
    }

    /**
     * Create a new instance with updated configuration
     */
    withConfig(config: Partial<AgentConfig>): ReActAgent {
        return new ReActAgent(
            this.engine,
            this.llmProvider,
            this.promptGenerator,
            this.state.name,
            { ...this.state.config, ...config },
        );
    }

    /**
     * Process a user message using ReAct reasoning
     * Delegates the actual processing to the ReActEngine
     */
    async processMessage(message: string, conversationHistory: Input[] = []): Promise<Response> {
        this.logger.info('Processing message with ReAct agent', { 
            message,
            userId: this.state.config.userId,
            historyLength: conversationHistory.length
        });
        
        try {
            if (this.isSimpleGreeting(message)) {
                return await this.handleSimpleGreeting(message);
            }
            
            return await this.handleComplexMessage(message);
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

    private async handleSimpleGreeting(message: string): Promise<Response> {
        this.logger.info('Simple greeting detected, using simple prompt');
        
        const prompt = await this.getSimplePrompt();
        await this.llmProvider.setSystemPrompt(prompt);
        
        const response = await this.llmProvider.generateResponse(message, [], []);
        
        return {
            content: response.content,
            tokenCount: response.tokenCount,
            toolResults: []
        };
    }

    private async handleComplexMessage(message: string): Promise<Response> {
        const content = await this.engine.process(message, this.state.config.userId);
        
        try {
            const lastStep = await this.engine.getLastReasoningStep(this.state.config.userId);
            if (lastStep) {
                this.lastReasoningStep = lastStep;
            }
        } catch (error) {
            this.logger.warn('Failed to retrieve last reasoning step', { 
                error: error instanceof Error ? error.message : String(error) 
            });
        }
        
        return {
            content,
            tokenCount: null,
            toolResults: []  // Since we're not tracking tool results in the engine response
        };
    }

    private async getSimplePrompt(): Promise<string> {
        if (this.promptGenerator.generateSimplePrompt) {
            this.logger.debug('Using prompt generator for simple prompt');
            return await this.promptGenerator.generateSimplePrompt();
        }
        
        this.logger.debug('Using fallback simple prompt');
        return 'You are a helpful AI assistant. Please respond to the user in a friendly and concise manner.';
    }

    /**
     * Check if a message is a simple greeting
     */
    private isSimpleGreeting(message: string): boolean {
        const simpleGreetings = ['hi', 'hello', 'hey', 'greetings', 'howdy', 'hi there', 'hello there'];
        const commonPhrases = ['how are you', 'how do you do', 'how\'s it going'];
        const normalizedMessage = message.toLowerCase().trim();
        
        return simpleGreetings.includes(normalizedMessage) ||
            simpleGreetings.some(greeting => normalizedMessage.startsWith(`${greeting}`)) ||
            commonPhrases.some(phrase => normalizedMessage.includes(phrase));
    }

    /**
     * Execute a tool directly
     * Delegates to the engine's tool execution functionality
     */
    async executeTool(tool: ToolDefinition, args: Record<string, unknown>): Promise<ToolResponse> {
        this.logger.info('Executing tool directly', { tool: tool.name, args });
        
        try {
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
     * Clean up resources used by the agent
     */
    async cleanup(): Promise<void> {
        this.logger.debug('Cleaning up ReAct agent resources');
    }

    /**
     * Get the current agent state
     */
    getState(): AgentState {
        return { ...this.state };
    }

    // Required by Agent interface
    get id(): string {
        return this.state.id;
    }

    get name(): string {
        return this.state.name;
    }

    /**
     * Set debug mode by returning a new instance with updated state
     */
    setDebugMode(enabled: boolean): void {
        this.logger.info('Debug mode set', { enabled });
    }

    getLastThoughtProcess(): ReasoningStep | null {
        return this.lastReasoningStep;
    }
}