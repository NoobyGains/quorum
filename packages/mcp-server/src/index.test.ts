import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  MCP_SERVER_VERSION,
  MCP_SERVER_NAME,
  PING_TOOL,
  PingInputSchema,
  createServer,
  handlePing,
} from "./server.js";
import { MCP_SERVER_VERSION as IndexVersion } from "./index.js";

describe("@quorum/mcp-server", () => {
  it("re-exports a version string from the index barrel", () => {
    expect(IndexVersion).toBe("0.0.0");
    expect(MCP_SERVER_VERSION).toBe("0.0.0");
  });

  it("advertises a sensible server name", () => {
    expect(MCP_SERVER_NAME).toBe("quorum-mcp-server");
  });

  describe("ping tool", () => {
    it("declares the ping descriptor with an empty-object input schema", () => {
      expect(PING_TOOL.name).toBe("ping");
      expect(PING_TOOL.inputSchema).toEqual({
        type: "object",
        properties: {},
        additionalProperties: false,
      });
    });

    it("accepts an empty object and rejects extra keys at the zod layer", () => {
      expect(PingInputSchema.safeParse({}).success).toBe(true);
      expect(PingInputSchema.safeParse({ unexpected: 1 }).success).toBe(false);
    });

    it("handlePing returns a text 'pong' content block", () => {
      const result = handlePing();
      expect(result).toEqual({
        content: [{ type: "text", text: "pong" }],
      });
    });
  });

  describe("createServer()", () => {
    it("returns a Server instance", () => {
      const server = createServer();
      expect(server).toBeDefined();
      // Server is an EventEmitter-backed class; this is a cheap sanity check.
      expect(typeof (server as unknown as { connect: unknown }).connect).toBe(
        "function",
      );
    });

    it("round-trips a ping over an in-memory transport", async () => {
      const server = createServer();
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();

      const client = new Client(
        { name: "test-client", version: "0.0.0" },
        { capabilities: {} },
      );

      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      try {
        const tools = await client.listTools();
        expect(tools.tools.map((t) => t.name)).toContain("ping");

        const result = await client.callTool({
          name: "ping",
          arguments: {},
        });

        expect(result.content).toEqual([{ type: "text", text: "pong" }]);
      } finally {
        await client.close();
        await server.close();
      }
    });

    it("returns an isError result for unknown tools", async () => {
      const server = createServer();
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();

      const client = new Client(
        { name: "test-client", version: "0.0.0" },
        { capabilities: {} },
      );

      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      try {
        const result = await client.callTool({
          name: "nonexistent",
          arguments: {},
        });
        expect(result.isError).toBe(true);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
