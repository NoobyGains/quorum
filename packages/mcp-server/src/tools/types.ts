// Shared types + helpers for MCP tool registration.
//
// We keep the registration data-driven: every tool contributes a `ToolDef`
// with (name, description, inputSchema, jsonSchema, handler). The server
// iterates a single array and dispatches by name. That keeps the 15+ tool
// surface maintainable without per-tool boilerplate in server.ts.

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z, ZodTypeAny } from "zod";

import type { Store } from "@quorum/store";

/** Context passed to every tool handler. */
export interface ToolContext {
  store: Store;
}

/**
 * A single MCP tool definition. `inputSchema` validates incoming args; the
 * handler receives the parsed value. `jsonSchema` is what we advertise on
 * `tools/list` — keep it in sync with the Zod schema by hand (we don't pull
 * in zod-to-json-schema to avoid a dep balloon for this layer).
 */
export interface ToolDef<S extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: S;
  jsonSchema: Record<string, unknown>;
  handler: (args: z.infer<S>, ctx: ToolContext) => Promise<CallToolResult>;
}

/** Convenience: build a `text`-typed CallToolResult with a JSON body. */
export function textResult(payload: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload),
      },
    ],
  };
}

/** Convenience: build an `isError` result from a message. */
export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}
