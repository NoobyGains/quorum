// @quorum/mcp-server — factory for the MCP server instance.
//
// Exposes createServer(), which returns a Server configured with the single
// `ping` tool required by Phase 2 (issue #9). Future tools (artifact CRUD, etc.)
// will be registered on top of this factory in M1.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const MCP_SERVER_NAME = "quorum-mcp-server" as const;
export const MCP_SERVER_VERSION = "0.0.0" as const;

/** Zod schema for the `ping` tool input. Empty object — no parameters. */
export const PingInputSchema = z.object({}).strict();

/** JSON Schema counterpart advertised through `tools/list`. */
const PING_INPUT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {},
  additionalProperties: false,
};

/** Tool descriptor surfaced in `tools/list`. */
export const PING_TOOL = {
  name: "ping",
  description:
    "Liveness probe. Returns 'pong' and confirms the Quorum MCP server is reachable.",
  inputSchema: PING_INPUT_JSON_SCHEMA,
} as const;

/**
 * Handler for a `ping` tool invocation. Exported so tests can exercise it
 * directly without spinning up a transport.
 */
export function handlePing(): CallToolResult {
  return {
    content: [{ type: "text", text: "pong" }],
  };
}

/**
 * Create a configured MCP server instance with the `ping` tool registered.
 *
 * The server is *not* connected to any transport — the caller is responsible
 * for calling `server.connect(transport)`. This separation keeps the factory
 * testable against an in-memory transport.
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [PING_TOOL],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name !== PING_TOOL.name) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Unknown tool: ${name}`,
          },
        ],
      };
    }

    // Validate input — `ping` accepts an empty object only.
    const parsed = PingInputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Invalid arguments for ${name}: ${parsed.error.message}`,
          },
        ],
      };
    }

    return handlePing();
  });

  return server;
}
