import { expect } from 'chai';
import { ToolChainExecutor } from './tool-chain-executor';
import { ToolChainConfigBuilder } from './tool-chain-config';


describe('ToolChainExecutor', () => {
  let executor: ToolChainExecutor;

  before(() => {
    process.env.NODE_ENV = 'test';
  });

  beforeEach(() => {
    executor = new ToolChainExecutor();
  });

  describe('Tool Chain Execution', () => {
    it('should execute a chain of tools in sequence', async () => {
      // Mock tools
      const toolRegistry = {
        data_fetcher: async () => ({ data: 'test_data' }),
        data_transformer: async (input: any) => ({ 
          transformed: input.data.toUpperCase() 
        })
      };

      const config = new ToolChainConfigBuilder('test_chain')
        .addTool({ 
          name: 'data_fetcher',
          parameters: {} 
        })
        .addTool({ 
          name: 'data_transformer',
          parameters: { 
            data: '$fetchResult.data'  // Access nested data
          } 
        })
        .setResultMapping({
          'data_fetcher': 'fetchResult',
          'data_transformer': 'transformResult'
        })
        .build();

      const result = await executor.execute(config, toolRegistry);
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(2);
      expect(result.data[1].transformed).to.equal('TEST_DATA');
    });

    it('should handle tool errors and abort chain', async () => {
      const toolRegistry = {
        error_tool: async () => {
          throw new Error('Test error');
        }
      };

      const config = new ToolChainConfigBuilder('error_chain')
        .addTool({ 
          name: 'error_tool',
          parameters: {} 
        })
        .build();

      const result = await executor.execute(config, toolRegistry);
      expect(result.success).to.be.false;
      expect(result.error).to.exist;
      expect(result.data).to.have.length(0);
    });

    it('should respect custom abort conditions', async () => {
      const toolRegistry = {
        counter: async () => ({ count: 1 }),
        processor: async () => ({ processed: true })
      };

      const config = new ToolChainConfigBuilder('abort_chain')
        .addTool({ 
          name: 'counter',
          parameters: {} 
        })
        .addTool({ 
          name: 'processor',
          parameters: {} 
        })
        .addAbortCondition({
          type: 'custom',
          condition: (context: any) => context.counterResult?.count === 1
        })
        .setResultMapping({
          'counter': 'counterResult'
        })
        .build();

      const result = await executor.execute(config, toolRegistry);
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(1);
    });

    it('should pass results between tools correctly', async () => {
      const toolRegistry = {
        producer: async () => ({ value: [1, 2, 3] }),
        mapper: async (input: any) => ({
          mapped: input.value.map((x: number) => x * 2)
        })
      };

      const config = new ToolChainConfigBuilder('data_flow_chain')
        .addTool({ 
          name: 'producer',
          parameters: {} 
        })
        .addTool({ 
          name: 'mapper',
          parameters: { 
            value: '$producerResult.value'
          } 
        })
        .setResultMapping({
          'producer': 'producerResult',
          'mapper': 'mapperResult'
        })
        .build();

      const result = await executor.execute(config, toolRegistry);
      expect(result.success).to.be.true;
      expect(result.data).to.have.length(2);
      expect(result.data[1].mapped).to.deep.equal([2, 4, 6]);
    });

    it('should provide execution metadata', async () => {
      const toolRegistry = {
        simple_tool: async () => ({ done: true })
      };

      const config = new ToolChainConfigBuilder('metadata_chain')
        .addTool({ 
          name: 'simple_tool',
          parameters: {} 
        })
        .build();

      const result = await executor.execute(config, toolRegistry);
      expect(result.metadata).to.exist;
      expect(result.metadata?.executionTime).to.be.a('number');
      expect(result.metadata?.toolName).to.equal('chain_complete');
    });
  });
});
