import toolsConfig from "../config/tools.js" 

export class SystemPromptGenerator {
    generatePrompt(additionalContext: string = ""): string {
        const toolsContext = toolsConfig.tools
            .map(tool => {
                const schema = JSON.stringify(tool.inputSchema, null, 2);
                return `${tool.name}: ${tool.description}\nInput Schema: ${schema}`;
            })
            .join('\n\n');

        return `
        Available tools:
        ${toolsContext}

        To use a tool, format your response as: [Calling tool <tool-name> with args <json-args>]
        
        ${additionalContext}
        `.trim();
    }
}