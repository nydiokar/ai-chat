# AI Integration

## Overview

Kanebra provides comprehensive AI integration through multiple providers (OpenAI, Anthropic, Ollama) with a unified interface for seamless switching between models and providers.

## Architecture

### Provider Abstraction

```typescript
interface AIProvider {
  name: string;
  models: AIModel[];
  generateResponse(request: AIRequest): Promise<AIResponse>;
  estimateTokens(text: string): number;
}

interface AIRequest {
  messages: Message[];
  model: AIModel;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
  toolChoice?: 'auto' | 'none' | 'required';
}
```

### Supported Providers

#### OpenAI
- **Models**: GPT-3.5-turbo, GPT-4 variants
- **Features**: Basic text generation, tool calling support
- **Configuration**: API key, model selection, temperature, retries

#### Ollama (Local)
- **Models**: Various local models (Llama, Mistral, etc.)
- **Features**: Local inference, offline operation
- **Configuration**: Host URL, model name

**Note**: Anthropic/Claude integration is configured but no provider implementation exists yet.

## React Agent System

### Advanced ReAct Reasoning Engine

Kanebra implements a sophisticated ReAct (Reasoning + Action) agent with comprehensive reasoning tracing:

```typescript
interface ReactStep {
  thought: string;
  action: string;
  observation: string;
  result?: any;
}

interface ReactTrace {
  steps: ReactStep[];
  finalAnswer: string;
  totalTokens: number;
  executionTime: number;
}
```

### Tool Integration

The React agent can use various tools through the Model Context Protocol:

- **GitHub Tools**: Repository and issue management via MCP
- **Brave Search**: Web search capabilities via MCP
- **File System Tools**: Basic file operations
- **MCP Tools**: Extensible tool system through server connections

## Configuration

### Environment Variables

```env
# Provider Selection
MODEL=openai

# OpenAI Settings
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-3.5-turbo-0125
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_RETRIES=3

# Anthropic Settings
ANTHROPIC_API_KEY=your_key
CLAUDE_MODEL=claude-3-5-sonnet-20241022

# Ollama Settings
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2:latest
```

### Dynamic Provider Switching

```typescript
// Switch providers at runtime
const aiService = container.get<AIProvider>(TYPES.AIProvider);
const response = await aiService.generateResponse({
  messages: conversationMessages,
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7
});
```

## Basic Features

### Request Handling
- Basic token counting and rate limiting
- Error handling and retry logic
- Tool execution through MCP integration

## Error Handling

### Provider Fallbacks
```typescript
try {
  return await openAIProvider.generateResponse(request);
} catch (error) {
  logger.warn('OpenAI failed, trying Claude', { error });
  return await claudeProvider.generateResponse(request);
}
```

### Retry Logic
- Exponential backoff for transient failures
- Circuit breaker pattern for persistent failures
- Detailed error logging and monitoring

## Monitoring and Analytics

### Usage Metrics
- Token consumption tracking per provider
- Response time monitoring
- Error rate analysis
- Cost calculation and reporting

### Quality Assessment
- Response relevance scoring
- User satisfaction tracking
- Performance benchmarking across providers

## Security Considerations

### API Key Management
- Encrypted storage of API keys
- Key rotation procedures
- Access logging and auditing

### Content Safety
- Input validation and sanitization
- Output filtering for sensitive information
- Rate limiting to prevent abuse

## Testing Strategy

### Unit Tests
```typescript
describe('AI Service', () => {
  it('should handle provider fallback', async () => {
    // Mock OpenAI failure, verify Claude fallback
  });

  it('should estimate tokens accurately', () => {
    // Test token counting accuracy
  });
});
```

### Integration Tests
- End-to-end conversation flows
- Multi-provider switching scenarios
- Tool integration testing
- Performance benchmarking

## Future Enhancements

### Planned Features
- **Multi-modal Support**: Image and audio processing
- **Fine-tuned Models**: Custom model training and deployment
- **Advanced Reasoning**: Enhanced chain-of-thought patterns
- **Collaborative AI**: Multi-agent coordination

### Provider Expansion
- **Google Gemini**: Additional model diversity
- **Azure OpenAI**: Enterprise integration
- **Local Models**: Expanded Ollama model support
- **Custom Providers**: Plugin architecture for new AI services

## Troubleshooting

### Common Issues

**Provider Connection Failed**:
- Verify API keys are correct and active
- Check network connectivity and firewalls
- Review provider status pages for outages

**Slow Response Times**:
- Monitor token usage and rate limits
- Check model selection and parameters
- Review caching effectiveness

**Tool Integration Issues**:
- Verify MCP server configurations
- Check tool schema definitions
- Review tool execution logs

### Debug Commands

```bash
# Test AI provider connectivity
npm run ai:test

# Monitor AI service performance
npm run ai:metrics

# Debug React agent execution
npm run react:debug

# Check token usage
npm run ai:usage
```
