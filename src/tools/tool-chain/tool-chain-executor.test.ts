import { expect } from 'chai';
import { ToolChainExecutor } from './tool-chain-executor.js';
import sinon from 'sinon';
import winston from 'winston';
import { ToolChainConfigBuilder } from './tool-chain-config.js';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionContext } from './tool-chain-executor.js';

describe('ToolChainExecutor', function() {
  this.timeout(5000); // Increase timeout for all tests in this suite
  let executor: ToolChainExecutor;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox({
      useFakeTimers: false,  // Don't use fake timers as we have real async operations
      useFakeServer: false,  // Don't use fake server
      properties: ['spy', 'stub', 'mock']  // Enable all stub features
    });
    executor = new ToolChainExecutor();
    // Optimize logger to be in-memory only
    (executor as any).logger = winston.createLogger({
      transports: [new winston.transports.Console({ silent: true })],
      exitOnError: false
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('executes a simple chain successfully', async () => {
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'fetchData',
        parameters: { query: 'test' }
      })
      .build();

    const mockResponse = {
      content: [
        {
          type: 'text',
          text: 'test-data'
        }
      ]
    };

    const registry = {
      fetchData: sandbox.stub().resolves({
        success: true,
        data: mockResponse,
        metadata: {}
      })
    };

    const result = await executor.execute(chain, registry);
    
    expect(result.success).to.be.true;
    expect(result.data).to.deep.equal([{
      success: true,
      data: mockResponse,
      metadata: {}
    }]);
    expect(result.metadata?.toolName).to.equal('chain_complete');
  });

  it('handles parameter passing between tools', async () => {
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'first',
        parameters: { input: 'test' }
      })
      .addTool({
        name: 'second',
        parameters: { data: '$firstResult.output' }
      })
      .setResultMapping({
        first: 'firstResult'
      })
      .build();

    const registry = {
      first: sandbox.stub().resolves({ output: 'test-output' }),
      second: sandbox.stub().resolves({ result: 'success' })
    };

    const result = await executor.execute(chain, registry);
    
    expect(result.success).to.be.true;
    expect(registry.second.calledOnce).to.be.true;
    expect(registry.second.firstCall.args[0]).to.deep.equal({
      data: 'test-output'
    });
  });

  it('respects tool timeout configuration', async () => {
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'slowTool',
        parameters: {},
        timeout: 100 // Use a more reliable timeout
      })
      .build();

    let timeoutTriggered = false;
    const registry = {
      slowTool: sandbox.stub().callsFake(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            timeoutTriggered = true;
            resolve();
          }, 200); // Significantly longer than timeout
        });
        return { data: 'should not reach here' };
      })
    };

    const result = await executor.execute(chain, registry);
    expect(result.success).to.be.false;
    expect(result.error?.message).to.include('TIMEOUT:');
    expect(registry.slowTool.calledOnce).to.be.true;
  });

  it('retries failed tools up to maxRetries', async () => {
    const error = new Error('Test failure');
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'unreliable',
        parameters: {},
        maxRetries: 1
      })
      .build();

    const registry = { 
      unreliable: sandbox.stub()
        .onFirstCall().rejects(error)
        .onSecondCall().rejects(error) 
    };

    const result = await executor.execute(chain, registry);

    expect(result.success).to.be.false;
    expect(result.error).to.equal(error);
    expect(registry.unreliable.callCount).to.equal(2);
  });

  it('handles missing context values', async () => {
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'tool',
        parameters: {
          input: '$nonexistent.value'
        }
      })
      .build();

    const registry = { tool: sandbox.stub() };
    const result = await executor.execute(chain, registry);

    expect(result.success).to.be.false;
    expect(result.error?.message).to.include('Missing context value');
    expect(registry.tool.called).to.be.false;
  });

  it('aborts chain based on condition', async () => {
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'validator',
        parameters: {}
      })
      .addTool({
        name: 'processor',
        parameters: {}
      })
      .setResultMapping({
        validator: 'validatorResult'
      })
      .addAbortCondition({
        type: 'custom',
        condition: (...args: unknown[]) => {
          const context = args[0] as ExecutionContext;
          const validatorResult = context.validatorResult as { isValid: boolean };
          return !validatorResult?.isValid;
        }
      })
      .build();

    const registry = {
      validator: sandbox.stub().resolves({ isValid: false }),
      processor: sandbox.stub()
    };

    const result = await executor.execute(chain, registry);
    
    expect(result.success).to.be.true;
    expect(result.metadata?.toolName).to.equal('chain_aborted');
    expect(registry.processor.called).to.be.false;
  });

  it('handles parameter references', async () => {
    const context = {
      value1: 'test',
      value2: 'sample'
    };

    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'paramTest',
        parameters: {
          param1: '$value1',
          param2: '$value2'
        }
      })
      .build();

    const registry = {
      paramTest: sandbox.stub().resolves({ success: true })
    };

    const result = await executor.execute(chain, registry, context);
    expect(result.success).to.be.true;
    expect(registry.paramTest.calledOnce).to.be.true;
    expect(registry.paramTest.firstCall.args[0]).to.deep.equal({
      param1: 'test',
      param2: 'sample'
    });
  });

  it('handles sequential tool failures', async () => {
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'first',
        parameters: {},
        timeout: 100,
        maxRetries: 0
      })
      .addTool({
        name: 'second',
        parameters: {},
        maxRetries: 0
      })
      .build();

    // Use a promise to control timing
    let timeoutPromise = new Promise<void>(resolve => {
      setTimeout(resolve, 200); // Double the timeout
    });

    const registry = {
      first: sandbox.stub().callsFake(async () => {
        await timeoutPromise;
        return { data: 'should not reach here' };
      }),
      second: sandbox.stub().rejects(new Error('Should not be called'))
    };

    const result = await executor.execute(chain, registry);
    
    expect(result.success).to.be.false;
    expect(result.error?.message).to.include('TIMEOUT:');
    expect(registry.first.calledOnce).to.be.true;
    expect(registry.second.called).to.be.false;
  });

  it('validates tool return values', async () => {
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'invalid',
        parameters: {}
      })
      .build();

    const registry = {
      invalid: sandbox.stub().resolves(null) // Invalid return value
    };

    const result = await executor.execute(chain, registry);
    expect(result.success).to.be.false;
    expect(result.error?.message).to.include('returned no result');
  });

  it('handles complex chaining patterns', async () => {
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'first',
        parameters: { input: 'start' }
      })
      .addTool({
        name: 'second',
        parameters: { data: '$firstResult.output', extra: 'static' }
      })
      .addTool({
        name: 'third',
        parameters: { 
          combined: '$secondResult.processed',
          original: '$firstResult.output'
        }
      })
      .setResultMapping({
        first: 'firstResult',
        second: 'secondResult'
      })
      .build();

    const registry = {
      first: sandbox.stub().resolves({ output: 'data1' }),
      second: sandbox.stub().resolves({ processed: 'data2' }),
      third: sandbox.stub().resolves({ final: 'done' })
    };

    const result = await executor.execute(chain, registry);
    expect(result.success).to.be.true;
    expect(registry.first.calledOnce).to.be.true;
    expect(registry.second.calledOnce).to.be.true;
    expect(registry.third.calledOnce).to.be.true;
    expect(registry.third.firstCall.args[0]).to.deep.equal({
      combined: 'data2',
      original: 'data1'
    });
  });

  it('handles errors in the middle of chain', async () => {
    console.log('=== Starting test ===');
    console.log('Creating chain config...');
    const chain = new ToolChainConfigBuilder(uuidv4())
      .addTool({
        name: 'first',
        parameters: {}
      })
      .addTool({
        name: 'failingTool',
        parameters: {},
        maxRetries: 0
      })
      .addTool({
        name: 'third',
        parameters: {}
      })
      .build();
    
    console.log('Chain config created:', {
      id: chain.id,
      tools: chain.tools.map(t => t.name)
    });

    console.log('Creating registry...');
    const registry = {
      first: sandbox.stub().resolves({ step: 1 }),
      failingTool: sandbox.stub().callsFake(() => Promise.reject(new Error('Planned failure'))),
      third: sandbox.stub().resolves({ step: 3 })
    };
    console.log('Registry created with tools:', Object.keys(registry));
    console.log('Registry stubs:', {
      first: typeof registry.first,
      failingTool: typeof registry.failingTool,
      third: typeof registry.third
    });

    console.log('About to execute chain...');
    const result = await executor.execute(chain, registry);
    console.log('Chain execution completed');
    
    // Verify chain stopped at error
    console.log('Running assertions...');
    console.log('First tool:', {
      called: registry.first.called,
      calledOnce: registry.first.calledOnce,
      callCount: registry.first.callCount
    });
    console.log('Failing tool:', {
      called: registry.failingTool.called,
      calledOnce: registry.failingTool.calledOnce,
      callCount: registry.failingTool.callCount
    });
    console.log('Third tool:', {
      called: registry.third.called,
      calledOnce: registry.third.calledOnce,
      callCount: registry.third.callCount
    });

    expect(registry.first.calledOnce, 'first tool should be called once').to.be.true;
    expect(registry.failingTool.callCount, 'failing tool should be called 4 times (1 attempt + 3 retries)').to.equal(4);
    expect(registry.third.called, 'third tool should not be called').to.be.false;

    // Verify error state
    expect(result.success).to.be.false;
    expect(result.error?.message).to.equal('Planned failure');

    // Verify partial results were preserved
    expect(Array.isArray(result.data)).to.be.true;
    expect(result.data).to.have.length(1);
    expect(result.data[0]).to.deep.equal({ step: 1 });

    // Verify metadata
    expect(result.metadata?.toolName).to.equal('failingTool');
    expect(result.metadata?.attempts).to.equal(4);
    expect(result.metadata?.maxRetries).to.equal(3);
  });
});
