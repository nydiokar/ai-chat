import { MCPContainer } from "../src/tools/mcp/di/container.js";
import { mcpConfig } from "../src/mcp_config.js";
import { AgentFactory } from "../src/agents/agent-factory.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { ReActPromptGenerator } from "../src/prompt/react-prompt-generator.js";
import { MemoryFactory, MemoryProviderType } from "../src/memory/memory-factory.js";
import { ReasoningStep } from "../src/interfaces/react-types.js";
import { defaultConfig } from "../src/utils/config.js";
import readline from 'readline';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MemoryType } from "../src/interfaces/memory-provider.js";
import { Agent } from "../src/interfaces/base-agent.js";

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
console.log(`Loading environment from ${envPath}`);
dotenv.config({ path: path.join(__dirname, '..', envPath) });

/**
 * Format the reasoning step for display
 */
function formatStep(step: ReasoningStep): string {
  let output = `\n${step.stepId} [${new Date(step.timestamp).toLocaleTimeString()}]\n`;
  output += '='.repeat(80) + '\n';
  
  if (step.thought) {
    output += `🤔 THOUGHT\n`;
    output += `---------\n`;
    output += `Reasoning: ${step.thought.reasoning}\n`;
    if (step.thought.plan) {
      output += `Plan: ${step.thought.plan}\n`;
    }
    output += '\n';
  }
  
  if (step.action) {
    output += `🔧 ACTION\n`;
    output += `--------\n`;
    output += `Tool: ${step.action.tool}\n`;
    if (step.action.purpose) {
      output += `Purpose: ${step.action.purpose}\n`;
    }
    output += `Params: ${JSON.stringify(step.action.params, null, 2)}\n\n`;
  }
  
  if (step.observation) {
    output += `👁️ OBSERVATION\n`;
    output += `-------------\n`;
    output += `${step.observation.result}\n\n`;
  }
  
  if (step.conclusion) {
    output += `🏁 CONCLUSION\n`;
    output += `------------\n`;
    output += `Final Answer: ${step.conclusion.final_answer}\n`;
    if (step.conclusion.explanation) {
      output += `Explanation: ${step.conclusion.explanation}\n`;
    }
    output += '\n';
  }
  
  if (step.error_handling) {
    output += `❌ ERROR\n`;
    output += `--------\n`;
    output += `Error: ${step.error_handling.error}\n`;
    output += `Recovery: ${step.error_handling.recovery.log_error}\n`;
    output += `Alternate plan: ${step.error_handling.recovery.alternate_plan}\n\n`;
  }
  
  return output;
}

/**
 * Main CLI function
 */
async function main() {
  console.log("ReAct Agent CLI Tester");
  console.log("======================");
  console.log("Initializing components...");
  
  try {
    // 1. Initialize container and get the tool manager
    const container = new MCPContainer(mcpConfig);
    console.log("✅ MCP Container initialized");
    
    const toolManager = container.getToolManager();
    console.log("✅ Tool Manager retrieved");
    
    // 2. Refresh tool information
    await toolManager.refreshToolInformation();
    const availableTools = await toolManager.getAvailableTools();
    console.log(`✅ Tool information refreshed. ${availableTools.length} tools available`);
    
    // 3. Initialize memory provider
    const memoryFactory = MemoryFactory.getInstance({
      type: MemoryProviderType.IN_MEMORY
    });
    const memoryProvider = await memoryFactory.getProvider();
    console.log("✅ Memory Provider initialized");
    
    // 4. Create LLM provider with config
    const config = { ...defaultConfig };
    // Override specific OpenAI settings if needed
    config.openai.model = process.env.OPENAI_MODEL || "gpt-4-turbo";
    config.openai.temperature = 0.7;
    const llmProvider = new OpenAIProvider(config);
    console.log("✅ LLM Provider created");
    
    // 5. Create prompt generator
    const promptGenerator = new ReActPromptGenerator(toolManager);
    console.log("✅ Prompt Generator created");
    
    // 6. Create the agent using the AgentFactory
    const agent = await AgentFactory.createReActAgent(
      container,
      llmProvider,
      memoryProvider,
      toolManager,
      promptGenerator,
      "CLI-Agent"
    );
    console.log("✅ ReAct Agent created");
    
    // Setup the CLI interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log("\nReAct Agent is ready! Type your request or 'exit' to quit.");
    console.log("==========================================================\n");
    
    // User ID for this session
    const userId = `cli-user-${Date.now()}`;
    
    // Start the CLI loop
    promptUser();
    
    // Function to prompt user
    function promptUser() {
      rl.question('> ', async (input) => {
        if (input.toLowerCase() === 'exit') {
          console.log("Cleaning up...");
          await agent.cleanup();
          await memoryProvider.cleanup();
          rl.close();
          return;
        }
        
        try {
          console.log("\nProcessing request...");
          console.log("====================\n");
          
          // Process with agent
          const response = await agent.processMessage(input);
          
          // Get reasoning steps from memory
          const memories = await memoryProvider.search({
            userId,
            types: [MemoryType.THOUGHT_PROCESS],
            limit: 50,
            sortBy: 'timestamp',
            sortDirection: 'asc'
          });
          
          // Get the last thought process directly from the agent
          const lastThought = agent.getLastThoughtProcess();
          
          // Display reasoning process
          if (memories.entries.length > 0) {
            console.log("\nReasoning Process:");
            console.log("==================");
            
            for (const entry of memories.entries) {
              if (entry.content && entry.content.step) {
                console.log(formatStep(entry.content.step));
              }
            }
            
            console.log("\nFinal Answer:");
            console.log("=============");
            console.log(response.content);
          } else if (lastThought) {
            console.log("\nLast Thought Process:");
            console.log("=====================");
            console.log(formatStep(lastThought));
            
            console.log("\nFinal Answer:");
            console.log("=============");
            console.log(response.content);
          } else {
            console.log("No reasoning steps were recorded.");
            console.log("\nResult:", response.content);
          }
        } catch (error) {
          console.error("Error processing request:", error);
        }
        
        console.log("\n");
        promptUser(); // Continue the loop
      });
    }
    
  } catch (error) {
    console.error("Failed to initialize the ReAct Agent CLI:", error);
    process.exit(1);
  }
}

// Start the application
main().catch(error => {
  console.error("Unhandled exception:", error);
  process.exit(1);
}); 