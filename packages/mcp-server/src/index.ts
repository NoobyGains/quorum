#!/usr/bin/env node
// @quorum/mcp-server — stdio entry point.
//
// Wires `createServer()` to a StdioServerTransport so the server speaks MCP
// on stdin/stdout. This binary is intended to be launched by an MCP client
// (Claude Desktop, Codex CLI, etc.) and is registered as `quorum-mcp-server`
// via package.json `bin`.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

export { createServer, MCP_SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Detect whether this module is being executed directly (as opposed to being
// imported for its exports). Using import.meta.url keeps us ESM-friendly under
// NodeNext without relying on CommonJS globals.
const invokedDirectly = (() => {
  if (typeof process === "undefined" || !process.argv[1]) return false;
  try {
    const entry = new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
    return import.meta.url === entry;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err: unknown) => {
     
    console.error("[quorum-mcp-server] fatal:", err);
    process.exit(1);
  });
}
