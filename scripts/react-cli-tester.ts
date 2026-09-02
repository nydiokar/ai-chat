import { mcpConfig } from "../src/mcp_config.js";
import { AIFactory } from "../src/services/ai-factory.js";
import { MemoryFactory, MemoryProviderType } from "../src/memory/memory-factory.js";
import { ReasoningStep } from "../src/interfaces/react-types.js";
import readline from 'readline';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { MemoryType } from "../src/interfaces/memory-provider.js";
import { ReActAgent } from "../src/agents/react-agent.js";
import chalk from 'chalk';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
console.log(`Loading environment from ${envPath}`);
dotenv.config({ path: path.join(__dirname, '..', envPath) });

// Enable verbose logging to see ALL prompts and LLM responses
// This is already logged by ReActEngine, we just enable it here
process.env.REACT_VERBOSE_LOGGING = 'true';

/**
 * Truncate long text for readability
 */
function truncate(text: string, maxLength: number = 500): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + chalk.dim(` ... [+${text.length - maxLength} chars]`);
}

/**
 * Format JSON nicely
 */
function formatJSON(obj: any): string {
  return JSON.stringify(obj, null, 2)
    .split('\n')
    .map(line => {
      if (line.includes(':')) {
        const [key, ...value] = line.split(':');
        return chalk.cyan(key) + ':' + chalk.white(value.join(':'));
      }
      return chalk.gray(line);
    })
    .join('\n');
}

/**
 * Format the reasoning step for display
 */
function formatStep(step: ReasoningStep, iteration: number): string {
  let output = '\n';
  output += chalk.bgBlue.white.bold(` ITERATION ${iteration} `) + chalk.blue(` ${step.stepId} `) + chalk.dim(`[${new Date(step.timestamp).toLocaleTimeString()}]`) + '\n';
  output += chalk.blue('═'.repeat(80)) + '\n\n';

  if (step.thought) {
    output += chalk.yellow.bold(`💭 THOUGHT\n`);
    output += chalk.yellow('─'.repeat(40)) + '\n';
    output += chalk.white(`Reasoning: `) + chalk.gray(truncate(step.thought.reasoning, 300)) + '\n';
    if (step.thought.plan) {
      output += chalk.white(`Plan: `) + chalk.gray(truncate(step.thought.plan, 200)) + '\n';
    }
    output += '\n';
  }

  if (step.action) {
    output += chalk.green.bold(`⚡ ACTION\n`);
    output += chalk.green('─'.repeat(40)) + '\n';
    output += chalk.white(`Tool: `) + chalk.greenBright.bold(step.action.tool) + '\n';
    if (step.action.purpose) {
      output += chalk.white(`Purpose: `) + chalk.gray(step.action.purpose) + '\n';
    }
    output += chalk.white(`Params:\n`) + formatJSON(step.action.params) + '\n\n';
  }

  if (step.observation) {
    output += chalk.cyan.bold(`👁️  OBSERVATION\n`);
    output += chalk.cyan('─'.repeat(40)) + '\n';
    output += chalk.white(truncate(step.observation.result, 600)) + '\n\n';
  }

  if (step.conclusion) {
    output += chalk.magenta.bold(`✅ CONCLUSION\n`);
    output += chalk.magenta('─'.repeat(40)) + '\n';
    output += chalk.white(`Final Answer: `) + chalk.greenBright(truncate(step.conclusion.final_answer, 800)) + '\n';
    if (step.conclusion.explanation) {
      output += chalk.white(`Explanation: `) + chalk.gray(truncate(step.conclusion.explanation, 300)) + '\n';
    }
    output += '\n';
  }

  if (step.error_handling) {
    output += chalk.red.bold(`❌ ERROR\n`);
    output += chalk.red('─'.repeat(40)) + '\n';
    output += chalk.white(`Error: `) + chalk.redBright(step.error_handling.error) + '\n';
    output += chalk.white(`Recovery: `) + chalk.gray(step.error_handling.recovery.log_error) + '\n';
    output += chalk.white(`Alternate plan: `) + chalk.gray(step.error_handling.recovery.alternate_plan) + '\n\n';
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
    // 1. Initialize factory (handles MCP container + providers)
    await AIFactory.initialize(mcpConfig);
    console.log("? AIFactory initialized");

    const toolManager = AIFactory.getToolManager();
    console.log("? Tool Manager retrieved");

    // 2. Refresh tool information so CLI reflects current state
    await toolManager.refreshToolInformation();
    const availableTools = await toolManager.getAvailableTools();
    console.log(`? Tool information refreshed. ${availableTools.length} tools available`);

    // 3. Initialize memory provider
    const memoryFactory = MemoryFactory.getInstance({
      type: MemoryProviderType.IN_MEMORY
    });
    const memoryProvider = await memoryFactory.getProvider();
    console.log("? Memory Provider initialized");

    // User ID for this session (create BEFORE agent)
    const userId = `cli-user-${Date.now()}`;

    // 4. Create the agent using the AIFactory (ensures ToT + future features)
    const agentInstance = await AIFactory.create(
      process.env.OPENAI_MODEL,
      "CLI-Agent",
      memoryProvider,
    );

    // Configure agent with the userId so memory saves correctly
    const agent = (agentInstance as ReActAgent).withConfig({ userId });
    console.log(`? ReAct Agent created with userId: ${userId}`);

    // Setup the CLI interface
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log("\nReAct Agent is ready! Type your request or 'exit' to quit.");
    console.log("==========================================================\n");
    
    // Start the CLI loop
    promptUser();
    
    // Function to prompt user
    function promptUser() {
      rl.question('> ', async (input) => {
        const trimmedInput = input.trim();

        if (trimmedInput.toLowerCase() === 'exit') {
          console.log("Cleaning up...");
          await agent.cleanup();
          await memoryProvider.cleanup();
          AIFactory.cleanup();
          rl.close();
          return;
        }

        if (!trimmedInput) {
          console.log("Please enter a question or type 'exit' to quit.\n");
          promptUser();
          return;
        }
        
        try {
          console.log("\n" + chalk.bgCyan.black.bold(" 🚀 PROCESSING REQUEST "));
          console.log(chalk.cyan('═'.repeat(80)));
          console.log(chalk.white.bold("User Query: ") + chalk.yellow(trimmedInput));
          console.log(chalk.cyan('═'.repeat(80)) + "\n");
          console.log(chalk.dim("💡 Tip: Watch for 'CONTEXTUAL PROMPT' and 'LLM RAW RESPONSE' logs below\n"));

          // Process with agent
          const response = await agent.processMessage(trimmedInput);

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
            console.log("\n" + chalk.bgMagenta.white.bold(" 🧠 REASONING PROCESS "));
            console.log(chalk.magenta('═'.repeat(80)) + "\n");

            let iteration = 1;
            for (const entry of memories.entries) {
              if (entry.content && entry.content.step) {
                console.log(formatStep(entry.content.step, iteration));
                iteration++;
              }
            }
            
            console.log("\n" + chalk.bgGreen.white.bold(" ✨ FINAL ANSWER "));
            console.log(chalk.green('═'.repeat(80)));
            console.log(chalk.white(response.content));
            console.log(chalk.green('═'.repeat(80)));
          } else if (lastThought) {
            console.log("\n" + chalk.bgMagenta.white.bold(" 🧠 REASONING PROCESS "));
            console.log(chalk.magenta('═'.repeat(80)) + "\n");
            console.log(formatStep(lastThought, 1));

            console.log("\n" + chalk.bgGreen.white.bold(" ✨ FINAL ANSWER "));
            console.log(chalk.green('═'.repeat(80)));
            console.log(chalk.white(response.content));
            console.log(chalk.green('═'.repeat(80)));
          } else {
            console.log(chalk.yellow("⚠️  No reasoning steps were recorded."));
            console.log("\n" + chalk.bgGreen.white.bold(" ✨ RESULT "));
            console.log(chalk.green('═'.repeat(80)));
            console.log(chalk.white(response.content));
            console.log(chalk.green('═'.repeat(80)));
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
    AIFactory.cleanup();
    process.exit(1);
  }
}

// Start the application
main().catch(error => {
  console.error("Unhandled exception:", error);
  AIFactory.cleanup();
  process.exit(1);
}); 

