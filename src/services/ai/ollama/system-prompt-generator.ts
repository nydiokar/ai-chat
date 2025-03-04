import { MCPTool } from "../../../types/index.js";

export class OllamaSystemPromptGenerator {
    private readonly defaultIdentity = `You are an AI assistant that can perform web searches using Brave Search.
IMPORTANT: You MUST always format your responses as JSON when using search tools.
Format: {"query": "your search query", "count": optional_number_of_results}`;

    generatePrompt(tools?: MCPTool[]): string {
        const parts = [this.defaultIdentity];

        if (tools && tools.length > 0) {
            const searchTools = tools.filter(t => 
                t.name.includes('brave') && t.name.includes('search')
            );

            if (searchTools.length > 0) {
                parts.push('\nSearch Tool Usage:');
                
                searchTools.forEach(tool => {
                    parts.push(`
Tool: ${tool.name}
Description: ${tool.description}

Response Format Examples:
1. Basic search:
   {"query": "latest news about OpenAI"}

2. With result count:
   {"query": "AI breakthroughs 2024", "count": 3}

Instructions:
1. ALWAYS return a JSON object with at least a "query" field
2. Use "count" field to limit results (optional, defaults to 5)
3. Keep queries focused and specific
4. Use proper JSON syntax with double quotes
5. No need to include function names or additional formatting
6. After receiving results, you'll be asked to summarize them`);
                });

                parts.push(`
Example Interactions:
User: "Find news about artificial intelligence"
You: {"query": "latest artificial intelligence news 2024"}

User: "Get 3 articles about OpenAI"
You: {"query": "OpenAI recent developments", "count": 3}

Remember: The response must be pure JSON that can be parsed - no additional text or formatting.`);
            }
        }

        return parts.join('\n');
    }
}
