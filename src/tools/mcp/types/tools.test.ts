import { expect } from 'chai';
import { ToolDefinition, MCPToolSchema, ToolResponse } from './tools.js';

describe('Tool Schema', () => {
    it('should create a valid tool definition', () => {
        const tool: ToolDefinition = {
            name: 'test_tool',
            description: 'A test tool',
            inputSchema: {
                type: 'object',
                properties: {
                    param1: { 
                        type: 'string',
                        description: 'A test parameter'
                    }
                },
                required: ['param1']
            }
        };

        console.log('Testing tool definition:');
        console.log(JSON.stringify(tool, null, 2));

        expect(tool.name).to.be.a('string');
        expect(tool.description).to.be.a('string');
        expect(tool.inputSchema.type).to.equal('object');
        expect(tool.inputSchema.properties).to.be.an('object');
        expect(tool.inputSchema.required).to.be.an('array');
    });

    it('should support optional fields', () => {
        const tool: ToolDefinition = {
            name: 'advanced_tool',
            description: 'A tool with optional fields',
            inputSchema: {
                type: 'object',
                properties: {
                    param1: { 
                        type: 'string',
                        description: 'Required parameter'
                    },
                    param2: {
                        type: 'number',
                        description: 'Optional parameter'
                    }
                },
                required: ['param1']
            },
            version: '1.0.0',
            metadata: {
                category: 'test'
            },
            enabled: true
        };

        console.log('Testing optional fields:');
        console.log(JSON.stringify(tool, null, 2));

        expect(tool.version).to.equal('1.0.0');
        expect(tool.metadata).to.deep.equal({ category: 'test' });
        expect(tool.enabled).to.be.true;
    });

    it('should support different parameter types', () => {
        const schema: MCPToolSchema = {
            type: 'object',
            properties: {
                stringParam: { 
                    type: 'string',
                    description: 'A string parameter'
                },
                numberParam: { 
                    type: 'number',
                    description: 'A number parameter'
                },
                booleanParam: {
                    type: 'boolean',
                    description: 'A boolean parameter'
                },
                enumParam: {
                    type: 'string',
                    description: 'An enum parameter',
                    enum: ['option1', 'option2']
                }
            },
            required: ['stringParam']
        };

        console.log('Testing parameter types:');
        console.log(JSON.stringify(schema, null, 2));

        expect(schema.properties.stringParam.type).to.equal('string');
        expect(schema.properties.numberParam.type).to.equal('number');
        expect(schema.properties.booleanParam.type).to.equal('boolean');
        expect(schema.properties.enumParam.enum).to.deep.equal(['option1', 'option2']);
    });

    it('should match OpenAI function schema format', () => {
        const tool: ToolDefinition = {
            name: 'list_files',
            description: 'List files in a directory',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { 
                        type: 'string',
                        description: 'Directory path'
                    },
                    recursive: {
                        type: 'boolean',
                        description: 'Whether to list files recursively'
                    }
                },
                required: ['path']
            }
        };

        // This is how OpenAI expects it
        const expectedOpenAIFormat = {
            type: 'function',
            function: {
                name: 'list_files',
                description: 'List files in a directory',
                parameters: {
                    type: 'object',
                    properties: {
                        path: { 
                            type: 'string',
                            description: 'Directory path'
                        },
                        recursive: {
                            type: 'boolean',
                            description: 'Whether to list files recursively'
                        }
                    },
                    required: ['path']
                }
            }
        };

        // Verify our schema can be easily converted to OpenAI format
        const openAIFormat = {
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema
            }
        };

        console.log('Testing OpenAI format compatibility:');
        console.log('Our format:');
        console.log(JSON.stringify(tool, null, 2));
        console.log('Converted to OpenAI format:');
        console.log(JSON.stringify(openAIFormat, null, 2));
        console.log('Expected OpenAI format:');
        console.log(JSON.stringify(expectedOpenAIFormat, null, 2));

        expect(openAIFormat).to.deep.equal(expectedOpenAIFormat);
    });

    it('should support tool response format', () => {
        const successResponse: ToolResponse = {
            success: true,
            data: ['file1.txt', 'file2.txt'],
            metadata: { count: 2 }
        };

        const errorResponse: ToolResponse = {
            success: false,
            data: null,
            error: 'Directory not found'
        };

        console.log('Testing response formats:');
        console.log('Success response:');
        console.log(JSON.stringify(successResponse, null, 2));
        console.log('Error response:');
        console.log(JSON.stringify(errorResponse, null, 2));

        expect(successResponse.success).to.be.true;
        expect(successResponse.data).to.be.an('array');
        expect(successResponse.metadata).to.deep.equal({ count: 2 });

        expect(errorResponse.success).to.be.false;
        expect(errorResponse.error).to.be.a('string');
    });

    it('should support server configuration', () => {
        const tool: ToolDefinition = {
            name: 'remote_tool',
            description: 'A tool on a remote server',
            inputSchema: {
                type: 'object',
                properties: {
                    param1: { type: 'string' }
                },
                required: ['param1']
            },
            server: {
                id: 'server1',
                name: 'Test Server',
                command: 'test',
                args: []
            }
        };

        console.log('Testing server configuration:');
        console.log(JSON.stringify(tool, null, 2));

        expect(tool.server).to.have.property('id');
        expect(tool.server).to.have.property('name');
        expect(tool.server).to.have.property('command');
        expect(tool.server?.args).to.be.an('array');
    });
}); 