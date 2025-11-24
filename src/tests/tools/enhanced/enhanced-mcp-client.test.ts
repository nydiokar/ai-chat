import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import sinon from "sinon";
import { EnhancedMCPClient } from "../../../tools/mcp/enhanced/enhanced-mcp-client.js";
import { ServerConfig } from "../../../tools/mcp/types/server.js";

describe("EnhancedMCPClient", () => {
  let mcpClient: EnhancedMCPClient;
  let config: ServerConfig;
  let mockConnect: sinon.SinonStub;
  let mockRequest: sinon.SinonStub;
  let mockClose: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    console.log("\n=== Setting up enhanced test ===");
    clock = sinon.useFakeTimers();

    // Create config
    config = {
      id: "test-server",
      name: "Test Server",
      command: "test-command",
      args: [],
    };
    console.log("Config created:", JSON.stringify(config, null, 2));

    // Create mock methods
    mockConnect = sinon.stub().resolves();
    mockRequest = sinon.stub().resolves({});
    mockClose = sinon.stub().resolves();
    console.log("Mock methods created");

    // Create instance with test mode enabled
    mcpClient = new EnhancedMCPClient(config, "test-server", {
      testMode: true,
    });
    console.log("EnhancedMCPClient instance created in test mode");

    // Replace the client and transport instances with our mocks
    const mockClient = {
      connect: mockConnect,
      request: mockRequest,
    };
    const mockTransport = {
      close: mockClose,
      stderr: "inherit",
    };
    console.log("Mock client and transport created");

    // @ts-ignore - Accessing protected properties for testing
    mcpClient["client"] = mockClient;
    // @ts-ignore - Accessing protected properties for testing
    mcpClient["transport"] = mockTransport;
    console.log("Mocks injected into client");
  });

  afterEach(() => {
    clock.restore();
  });

  describe("caching", () => {
    it("should cache listTools results", async () => {
      console.log("\n=== Testing tool list caching ===");
      const mockTools = [
        {
          name: "test-tool",
          description: "Test tool",
          version: "1.0.0",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      ];
      console.log("Mock tools:", JSON.stringify(mockTools, null, 2));

      mockRequest.resolves(mockTools);

      // First call should hit the API
      const firstResult = await mcpClient.listTools();
      console.log("First call result:", JSON.stringify(firstResult, null, 2));
      expect(mockRequest.callCount).to.equal(1);

      // Second call should use cache
      const secondResult = await mcpClient.listTools();
      console.log(
        "Second call result (from cache):",
        JSON.stringify(secondResult, null, 2),
      );
      expect(mockRequest.callCount).to.equal(1);
      expect(secondResult).to.deep.equal(firstResult);

      // After TTL expires, should hit API again
      await clock.tickAsync(2 * 60 * 1000 + 1); // Just over 2 minutes
      const thirdResult = await mcpClient.listTools();
      console.log(
        "Third call result (after TTL):",
        JSON.stringify(thirdResult, null, 2),
      );
      expect(mockRequest.callCount).to.equal(2);
    });

    it("should report cache status", () => {
      console.log("\n=== Testing cache status ===");
      const status = mcpClient.getCacheStatus();
      console.log("Cache status:", status);
      expect(status).to.have.property("size");
      expect(status).to.have.property("lastCleanup");
      expect(status).to.have.property("ttl");
      expect(status.ttl).to.equal(2 * 60 * 1000); // 2 minutes
    });
  });

  describe("health monitoring", () => {
    it("should perform health checks", async () => {
      console.log("\n=== Testing health monitoring ===");
      const healthListener = sinon.spy();
      mcpClient.on("health.status", healthListener);

      // Mock successful listTools response
      const mockTools = [
        {
          name: "test-tool",
          description: "Test tool",
          version: "1.0.0",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      ];
      mockRequest.resolves(mockTools);

      // Trigger health check manually since we're in test mode
      await mcpClient["checkHealth"]();

      expect(mockRequest.calledOnce).to.be.true;
      expect(healthListener.calledOnce).to.be.true;

      const emittedStatus = healthListener.firstCall.args[0];
      expect(emittedStatus).to.have.property("status", "HEALTHY");
      expect(emittedStatus).to.have.property("serverId", "test-server");
      expect(emittedStatus).to.have.property("timestamp");

      const status = mcpClient.getHealthStatus();
      console.log("Health status:", status);
      expect(status.status).to.equal("OK");
    });

    it("should emit health errors", async () => {
      console.log("\n=== Testing health error handling ===");
      const healthListener = sinon.spy();
      mcpClient.on("health.status", healthListener);

      // Mock failed listTools response
      const error = new Error("Health check failed");
      mockRequest.rejects(error);
      console.log("Setting up health check error:", error.message);

      // Trigger health check manually since we're in test mode
      await mcpClient["checkHealth"]();

      expect(healthListener.calledOnce).to.be.true;
      const emittedStatus = healthListener.firstCall.args[0];
      expect(emittedStatus).to.have.property("status", "UNHEALTHY");
      expect(emittedStatus).to.have.property("serverId", "test-server");
      expect(emittedStatus).to.have.property("timestamp");
      expect(emittedStatus).to.have.property("error", error);
    });
  });

  describe("event system", () => {
    it("should emit tool events", async () => {
      console.log("\n=== Testing tool events ===");
      const calledListener = sinon.spy();
      const successListener = sinon.spy();
      const errorListener = sinon.spy();

      mcpClient.on("tool.called", calledListener);
      mcpClient.on("tool.success", successListener);
      mcpClient.on("tool.error", errorListener);

      // Test successful tool call
      const mockResponse = {
        content: [
          {
            type: "text",
            text: "test result",
          },
        ],
      };
      mockRequest.resolves(mockResponse);
      console.log("Testing successful tool call");
      const response = await mcpClient.callTool("test-tool", {
        param: "value",
      });

      expect(calledListener.calledOnce).to.be.true;
      expect(successListener.calledOnce).to.be.true;
      expect(errorListener.called).to.be.false;
      expect(response).to.deep.equal({
        success: true,
        data: mockResponse,
        metadata: {},
      });

      console.log(
        "Called event args:",
        JSON.stringify(calledListener.firstCall.args[0], null, 2),
      );
      console.log(
        "Success event args:",
        JSON.stringify(successListener.firstCall.args[0], null, 2),
      );

      // Test failed tool call
      mockRequest.rejects(new Error("Tool failed"));
      console.log("\nTesting failed tool call");
      try {
        await mcpClient.callTool("test-tool", { param: "value" });
      } catch (error) {
        expect(calledListener.calledTwice).to.be.true;
        expect(successListener.calledOnce).to.be.true;
        expect(errorListener.calledOnce).to.be.true;
        console.log(
          "Error event args:",
          JSON.stringify(errorListener.firstCall.args[0], null, 2),
        );
      }
    });
  });
});
