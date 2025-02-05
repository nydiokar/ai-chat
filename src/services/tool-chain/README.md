# Tool Chain System

## Overview
The Tool Chain System provides a flexible and robust mechanism for chaining multiple tools together, with advanced features like result passing, abort conditions, and comprehensive logging.

## Key Components

### ToolChainConfig
Defines the configuration for a tool chain, including:
- Unique ID
- Name and description
- List of tools to execute
- Abort conditions
- Result mapping

### ToolChainExecutor
Manages the execution of tool chains with features:
- Dynamic input preparation
- Abort condition checking
- Error handling
- Performance tracking
- Detailed logging

## Usage Example

```typescript
// Create a tool registry
const toolRegistry = createToolRegistry({
  'fetch_data': async (input) => { /* implementation */ },
  'process_data': async (input) => { /* implementation */ },
  'save_result': async (input) => { /* implementation */ }
});

// Build a tool chain configuration
const chainConfig = new ToolChainConfigBuilder('data_processing_chain')
  .addTool({ 
    name: 'fetch_data', 
    parameters: { url: 'https://api.example.com/data' } 
  })
  .addTool({ 
    name: 'process_data', 
    parameters: { data: '$fetch_data' } 
  })
  .addTool({ 
    name: 'save_result', 
    parameters: { processedData: '$process_data' } 
  })
  .addAbortCondition({
    type: 'error',
    condition: () => true // Abort on any error
  })
  .setResultMapping({
    'fetch_data': 'rawData',
    'process_data': 'processedData'
  })
  .build();

// Execute the tool chain
const executor = new ToolChainExecutor();
const result = await executor.execute(chainConfig, toolRegistry);
```

## Features
- Result chaining between tools
- Flexible abort conditions
- Comprehensive error handling
- Performance tracking
- Detailed logging
- Type-safe configuration

## Performance Considerations
- Execution overhead is minimized
- Detailed metadata tracking
- Configurable abort conditions

## Abort Condition Types
1. **error**: Abort chain if any tool fails
2. **result**: Abort based on specific result conditions
3. **custom**: Most flexible abort condition type

## Result Mapping
Allows dynamic passing of results between tools using `$` prefix syntax.

## Logging
Comprehensive logging with:
- Execution start/end timestamps
- Tool-level performance metrics
- Error details
- Execution context

## Future Improvements
- Enhanced caching mechanisms
- More sophisticated abort condition types
- Advanced performance monitoring
