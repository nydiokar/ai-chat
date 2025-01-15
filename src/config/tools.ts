export const toolsConfig = {
    tools: [
        {
            name: "test-tool",
            description: "Test tool for demonstration",
            inputSchema: {
                type: "object",
                properties: {
                    param: {
                        type: "string",
                        description: "Test parameter"
                    }
                }
            }
        }
    ]
} as const;

export default toolsConfig;
