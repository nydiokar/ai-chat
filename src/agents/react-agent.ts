import { ToolDefinition, ToolResponse } from "../tools/mcp/types/tools.js";
import { Agent, ThoughtProcess } from "../interfaces/agent.js";
import { LLMProvider } from "../interfaces/llm-provider.js";
import { Input, Response } from "../types/common.js";
import { ReActPromptGenerator } from "../prompt/react-prompt-generator.js";
import { MCPContainer } from "../tools/mcp/di/container.js";
import { getLogger } from '../utils/shared-logger.js';
import { OpenAIProvider } from '../providers/openai.js';
import yaml from 'js-yaml';
import { v4 as uuid } from 'uuid';

export class ReActAgent implements Agent {
    private readonly logger = getLogger('ReActAgent');
    public readonly id = uuid();
    public readonly name: string;

    constructor(
        private readonly container: MCPContainer,
        private readonly llmProvider: LLMProvider,
        private readonly promptGenerator: ReActPromptGenerator,
        name?: string
    ) {
        this.name = name ? `ReAct Agent: ${name}` : "ReAct Agent";
        this.logger.info('ReAct Agent initialized', { agentId: this.id, agentName: this.name });
    }

    private isSimpleQuery(input: string): boolean {
        // Detect simple queries that shouldn't use tools
        const simplePatterns = [
            /^hi+\s*$/i,
            /^hello+\s*$/i,
            /^hey+\s*$/i,
            /^greetings/i,
            /^how are you/i,
            /^what's up/i,
            /^good (morning|afternoon|evening)/i,
            /^thanks/i,
            /^thank you/i
        ];
        
        return simplePatterns.some(pattern => pattern.test(input.trim()));
    }

    async processMessage(input: string, history?: Input[]): Promise<Response> {
        // For very simple queries, bypass tool handling entirely
        if (this.isSimpleQuery(input)) {
            this.logger.info('Simple query detected, bypassing tool handling', { 
                input: input.substring(0, 50) 
            });
            
            // Generate a simple response prompt
            const simplePrompt = `You are a friendly AI assistant having a conversation.
Respond naturally to the user without using any tools.

Query: ${input}`;
            
            // Get response without tools
            return await this.llmProvider.generateResponse(simplePrompt, history);
        }
        
        // Get available tools for normal processing
        const tools = await this.container.getToolManager().getAvailableTools();
        
        // Generate initial prompt
        const prompt = await this.promptGenerator.generatePrompt(input, tools, history);
        
        // Get initial response
        let response = await this.llmProvider.generateResponse(prompt, history, tools);
        
        // If no tool calls, return directly
        if (!response.toolResults || response.toolResults.length === 0) {
            return response;
        }
        
        // Process tool calls from metadata
        const results: ToolResponse[] = [];
        const toolCallResults = [];
        
        for (const toolResult of response.toolResults) {
            const toolName = toolResult.metadata?.toolName || '';
            const toolCallId = toolResult.metadata?.toolCallId || '';
            const args = toolResult.metadata?.arguments || '{}';
            
            // Add detailed logging using the proper logger
            this.logger.info('Tool call details', {
                toolName,
                toolCallId,
                args,
                responseContent: response.content
            });
            
            const tool = await this.container.getToolManager().getToolByName(toolName);
            
            // Log additional info about the tool
            this.logger.info('Tool lookup result', {
                toolFound: !!tool,
                serverID: tool?.server?.id || 'none'
            });
            
            if (!tool) {
                const errorResult = {
                    success: false,
                    data: '',
                    error: `Tool ${toolName} not found`
                };
                results.push(errorResult);
                toolCallResults.push({
                    toolName,
                    toolCallId,
                    result: errorResult.error,
                    success: false
                });
                continue;
            }

            try {
                const parsedArgs = JSON.parse(args);
                const result = await this.container.getToolManager().executeTool(toolName, parsedArgs);
                results.push(result);
                
                // Add to tool call results for final response
                toolCallResults.push({
                    toolName,
                    toolCallId,
                    result: typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
                    success: result.success
                });
            } catch (error) {
                const errorResult = {
                    success: false,
                    data: '',
                    error: `Error executing tool: ${error}`
                };
                results.push(errorResult);
                toolCallResults.push({
                    toolName,
                    toolCallId,
                    result: `Error executing tool: ${error}`,
                    success: false
                });
            }
        }

        // Get final response from provider with tool results, if it supports the method
        let finalResponse: Response;
        
        if (this.llmProvider instanceof OpenAIProvider && toolCallResults.length > 0) {
            try {
                finalResponse = await this.llmProvider.getFinalResponse(input, toolCallResults, history);
                
                // Check if we still got tool calls in the final response (unexpected)
                if (finalResponse.toolResults && finalResponse.toolResults.length > 0) {
                    this.logger.warn('Got unexpected tool calls in final response, ignoring them', {
                        toolCount: finalResponse.toolResults.length
                    });
                    // Ignore the tool calls, only use the content
                }
                
                // Combine the responses
                return {
                    content: finalResponse.content,
                    tokenCount: (response.tokenCount || 0) + (finalResponse.tokenCount || 0),
                    toolResults: results
                };
            } catch (error) {
                this.logger.error('Error getting final response', { error });
                // Fall back to our standard response formatting
            }
        }
        
        // If we can't get a final response, format the tool results as content
        let enhancedContent = response.content;
        
        if (results.length > 0) {
            // Check if content is generic/default
            const isGenericContent = 
                response.content.includes('I need to use a tool') || 
                response.content.length === 0;
            
            if (isGenericContent) {
                const successfulResults = results.filter(r => r.success);
                if (successfulResults.length > 0) {
                    // Create a response based on the tool results
                    enhancedContent = this.formatToolResultsAsContent(successfulResults);
                }
            } else {
                // If content already has something meaningful, just append the tool results
                if (results.some(r => r.success && r.data)) {
                    enhancedContent += this.formatToolResultsAsSupplement(results);
                }
            }
        }

        // Return final response
        return {
            content: enhancedContent,
            tokenCount: response.tokenCount,
            toolResults: results
        };
    }

    private formatToolResultsAsContent(results: ToolResponse[]): string {
        if (results.length === 0) return '';
        
        // For a single result, format it nicely
        if (results.length === 1) {
            return results[0].data.toString();
        }
        
        // For multiple results, format as a list
        return results.map(r => r.data).join('\n\n');
    }
    
    private formatToolResultsAsSupplement(results: ToolResponse[]): string {
        const successfulResults = results.filter(r => r.success && r.data);
        if (successfulResults.length === 0) return '';
        
        return '\n\n' + successfulResults.map(r => r.data).join('\n');
    }

    async executeTool(tool: ToolDefinition | string, args: Record<string, unknown>): Promise<ToolResponse> {
        const toolName = typeof tool === 'string' ? tool : tool.name;
        const toolDef = typeof tool === 'string' ? 
            await this.container.getToolManager().getToolByName(tool) :
            tool;

        if (!toolDef) {
            return {
                success: false,
                data: `Tool ${toolName} not found`,
                error: 'Tool not found'
            };
        }
        
        try {
            // Use the container's toolManager to execute tool
            return await this.container.getToolManager().executeTool(toolName, args);
        } catch (error) {
            return {
                success: false,
                data: String(error),
                error: 'Tool execution failed'
            };
        }
    }

    async cleanup(): Promise<void> {
        // Nothing to clean up in this simplified version
    }

    setDebugMode(enabled: boolean): void {
        // Debug mode not needed in simplified version
    }

    getLastThoughtProcess(): ThoughtProcess | null {
        return null; // Not tracking thought process in simplified version
    }
}