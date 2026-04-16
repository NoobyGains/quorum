// Read/list/search tools — the generic `artifact.*` family. Unlike the
// create tools, these do not touch the factories; they just translate tool
// args into `Store` method calls and format the results.

import { z } from "zod";

import { ARTIFACT_TYPES, type Artifact } from "@quorum/artifacts";

import { type ToolDef, errorResult, textResult } from "./types.js";

// --- Input schemas ----------------------------------------------------------

const ReadInput = z
  .object({
    id: z.string().min(1),
  })
  .strict();

const ListInput = z
  .object({
    type: z.enum(ARTIFACT_TYPES).optional(),
    author: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
  })
  .strict();

const SearchInput = z
  .object({
    query: z.string().min(1),
    limit: z.number().int().positive().optional(),
  })
  .strict();

// --- JSON schemas for tools/list --------------------------------------------

const ReadJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", minLength: 1 },
  },
} as const;

const ListJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: {
      type: "string",
      enum: [...ARTIFACT_TYPES],
    },
    author: { type: "string", minLength: 1 },
    limit: { type: "integer", exclusiveMinimum: 0 },
  },
} as const;

const SearchJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", minLength: 1 },
    limit: { type: "integer", exclusiveMinimum: 0 },
  },
} as const;

// --- Shallow projection used by list/search ---------------------------------
//
// The full artifact bodies can be large; `list`/`search` return a compact
// header per hit to keep responses tractable. Callers who need the body
// should follow up with `artifact.read`.

function shallow(a: Artifact): {
  id: string;
  type: string;
  author: string;
  created: string;
  project: string;
  supersedes: string | null;
} {
  return {
    id: a.id,
    type: a.type,
    author: a.author,
    created: a.created,
    project: a.project,
    supersedes: a.supersedes,
  };
}

// --- Tool definitions -------------------------------------------------------

const readTool: ToolDef<typeof ReadInput> = {
  name: "artifact.read",
  description:
    "Read a single artifact by id. Returns the full JSON body, or { found: false }.",
  inputSchema: ReadInput,
  jsonSchema: ReadJsonSchema,
  handler: async (args, ctx) => {
    try {
      const got = await ctx.store.read(args.id);
      if (!got) {
        return textResult({ found: false, id: args.id });
      }
      return textResult({ found: true, artifact: got });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(`Store.read failed: ${msg}`);
    }
  },
};

const listTool: ToolDef<typeof ListInput> = {
  name: "artifact.list",
  description:
    "List artifacts with optional type/author filters. Returns shallow headers.",
  inputSchema: ListInput,
  jsonSchema: ListJsonSchema,
  handler: async (args, ctx) => {
    try {
      const rows = await ctx.store.list({
        type: args.type,
        author: args.author,
        limit: args.limit,
      });
      return textResult({
        count: rows.length,
        artifacts: rows.map(shallow),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(`Store.list failed: ${msg}`);
    }
  },
};

const searchTool: ToolDef<typeof SearchInput> = {
  name: "artifact.search",
  description: "FTS5 search over artifact bodies. Returns shallow headers.",
  inputSchema: SearchInput,
  jsonSchema: SearchJsonSchema,
  handler: async (args, ctx) => {
    try {
      const rows = await ctx.store.search(args.query);
      const limited =
        args.limit !== undefined ? rows.slice(0, args.limit) : rows;
      return textResult({
        count: limited.length,
        artifacts: limited.map(shallow),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(`Store.search failed: ${msg}`);
    }
  },
};

// Widen to ToolDef[] so the barrel can concat freely with CREATE_TOOLS. The
// per-tool handler types are preserved above; this cast only affects the
// outer container.
export const ARTIFACT_TOOLS: ToolDef[] = [
  readTool as unknown as ToolDef,
  listTool as unknown as ToolDef,
  searchTool as unknown as ToolDef,
];
