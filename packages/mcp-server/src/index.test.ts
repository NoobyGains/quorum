import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "@quorum/store";

import {
  MCP_SERVER_VERSION,
  MCP_SERVER_NAME,
  PING_TOOL,
  PingInputSchema,
  createServer,
  handlePing,
} from "./server.js";
import { MCP_SERVER_VERSION as IndexVersion } from "./index.js";

// Helper: build a createServer that's backed by a tmp-dir Store so we don't
// touch `process.cwd()` or the user's `~/.quorum/`. The caller owns cleanup
// via the returned `dispose()`.
function withTmpStore(): {
  factory: () => Store;
  dispose: () => Promise<void>;
} {
  const tmpHome = mkdtempSync(join(tmpdir(), "quorum-mcp-index-"));
  const store = new Store("/fake/project/mcp-index-test", {
    homeDir: tmpHome,
    warn: () => {},
  });
  return {
    factory: () => store,
    dispose: async () => {
      try {
        await store.close();
      } catch {
        // server's onclose already closed it
      }
      rmSync(tmpHome, { recursive: true, force: true });
    },
  };
}

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
    let sink: { factory: () => Store; dispose: () => Promise<void> };

    beforeEach(() => {
      sink = withTmpStore();
    });

    afterEach(async () => {
      await sink.dispose();
    });

    it("returns a Server instance", () => {
      const server = createServer({ storeFactory: sink.factory });
      expect(server).toBeDefined();
      // Server is an EventEmitter-backed class; this is a cheap sanity check.
      expect(typeof (server as unknown as { connect: unknown }).connect).toBe(
        "function",
      );
    });

    it("round-trips a ping over an in-memory transport", async () => {
      const server = createServer({ storeFactory: sink.factory });
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
      const server = createServer({ storeFactory: sink.factory });
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

    it("advertises ping + 15 artifact tools (16 total)", async () => {
      const server = createServer({ storeFactory: sink.factory });
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
        const names = tools.tools.map((t) => t.name).sort();
        expect(names).toEqual(
          [
            "ping",
            "plan.create",
            "claim.create",
            "hypothesis.create",
            "experiment.create",
            "result.create",
            "decision.create",
            "question.create",
            "commitment.create",
            "disagreement.create",
            "handoff.create",
            "review.create",
            "risk_flag.create",
            "artifact.read",
            "artifact.list",
            "artifact.search",
          ].sort(),
        );
        expect(tools.tools).toHaveLength(16);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });
});
