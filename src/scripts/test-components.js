// Quick test script for the ReActStepParser and ReActToolHandler components
import { ReActStepParser } from '../agents/react-step-parser.js';
import { ReActToolHandler } from '../agents/react-tool-handler.js';

console.log("=======================================");
console.log("Testing ReAct components");
console.log("=======================================");

// Test the parser
const parser = new ReActStepParser();
const yamlContent = `
\`\`\`yaml
thought:
  reasoning: I need to test this parser
  plan: Parse this YAML content
action:
  tool: test_tool
  params:
    query: "test query"
\`\`\`
`;

console.log("\nTesting ReActStepParser with YAML content:");
console.log(yamlContent);

const result = parser.parseReasoningStep(yamlContent);
console.log("\nParser result:");
console.log(JSON.stringify(result, null, 2));

if (result && result.thought && result.action) {
  console.log("\n✅ Parser test successful!");
} else {
  console.log("\n❌ Parser test failed!");
}

// Test the ReActToolHandler methods
console.log("\n\nTesting ReActToolHandler components...");

// Create a mock tool manager
const mockToolManager = {
  getAvailableTools: async () => [
    {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  ],
  executeTool: async (name, args) => ({ success: true, data: `Result for ${name} with args ${JSON.stringify(args)}` }),
  registerTool: async () => true,
  getToolByName: async () => null,
  refreshToolInformation: async () => {}
};

// Create a mock tool executor
const mockToolExecutor = {
  execute: async (config, registry, context) => ({
    success: true,
    data: "Test execution result",
    metadata: { executionTime: 100, toolName: 'test_tool' }
  })
};

// Create tool handler instance
const handler = new ReActToolHandler(mockToolManager, mockToolExecutor);

// Test creating an observation step
const observation = handler.createObservationStep("Test observation result");
console.log("\nObservation step result:");
console.log(JSON.stringify(observation, null, 2));

if (observation && observation.observation && observation.observation.result === "Test observation result") {
  console.log("\n✅ Observation step creation successful!");
} else {
  console.log("\n❌ Observation step creation failed!");
}

// Test tool result formatting
const formattedResult = handler.formatToolResult(
  { success: true, data: "Test formatted result", metadata: { executionTime: 100, toolName: 'test_tool' } },
  { tool: "test_tool", params: { query: "test query" } }
);

console.log("\nFormatted tool result:");
console.log(formattedResult);

if (formattedResult && formattedResult.includes("Test formatted result")) {
  console.log("\n✅ Tool result formatting successful!");
} else {
  console.log("\n❌ Tool result formatting failed!");
}

console.log("\n=======================================");
console.log("Components test completed");
console.log("======================================="); 