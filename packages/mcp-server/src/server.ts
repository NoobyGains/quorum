// @quorum/mcp-server — factory for the MCP server instance.
//
// Exposes createServer(), which returns a Server configured with:
//   - the `ping` liveness probe (Phase 2 / issue #9)
//   - 12 create tools, one per artifact type (M1 Wave 3 / issue #25)
//   - 3 generic read/list/search tools (`artifact.*`)
//
// Tool dispatch is data-driven: we build a lookup table from the flat
// `ARTIFACT_MCP_TOOLS` array plus the ping descriptor, then register a
// single CallToolRequest handler that routes by name.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { Store } from "@quorum/store";

import {
  ARTIFACT_MCP_TOOLS,
  type ToolContext,
  type ToolDef,
} from "./tools/index.js";

export const MCP_SERVER_NAME = "quorum-mcp-server" as const;
export const MCP_SERVER_VERSION = "0.0.0" as const;

// --- `ping` tool -------------------------------------------------------------

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

// --- Store factory injection -------------------------------------------------

/**
 * Options for `createServer`. `storeFactory` lets tests inject an in-memory
 * or tmp-dir-backed Store without having to munge `process.cwd()`.
 */
export interface CreateServerOptions {
  /**
   * Factory returning the Store that tool handlers should use. Called once
   * per `createServer` invocation. Defaults to a Store rooted at
   * `process.cwd()`.
   */
  storeFactory?: () => Store;
}

function defaultStoreFactory(): Store {
  return new Store(process.cwd());
}

// --- Public factory ----------------------------------------------------------

/**
 * Create a configured MCP server instance. The server is *not* connected to
 * any transport — the caller is responsible for calling `server.connect(...)`.
 */
export function createServer(opts: CreateServerOptions = {}): Server {
  const store = (opts.storeFactory ?? defaultStoreFactory)();
  const ctx: ToolContext = { store };

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

  // Build a name -> ToolDef lookup for the artifact tools.
  const toolsByName = new Map<string, ToolDef>(
    ARTIFACT_MCP_TOOLS.map((t) => [t.name, t]),
  );

  // Advertised tool list. `ping` stays first so the existing contract is
  // preserved; the artifact tools follow in a deterministic order.
  const advertisedTools = [
    PING_TOOL,
    ...ARTIFACT_MCP_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.jsonSchema,
    })),
  ];

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: advertisedTools,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === PING_TOOL.name) {
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
    }

    const tool = toolsByName.get(name);
    if (!tool) {
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

    // Every artifact tool MUST validate its args via Zod before touching the
    // store — otherwise the store's own ArtifactSchema.safeParse would throw
    // late with a less helpful message.
    const parsed = tool.inputSchema.safeParse(args ?? {});
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

    return tool.handler(parsed.data as never, ctx);
  });

  // Ensure the injected Store is closed when the transport tears the server
  // down. The SDK's `Server` exposes an `onclose` hook for exactly this.
  const prevOnClose = server.onclose;
  server.onclose = () => {
    void store.close();
    prevOnClose?.();
  };

  return server;
}
