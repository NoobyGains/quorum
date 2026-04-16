// Barrel for all artifact MCP tools. Aggregates the 12 create tools with
// the 3 read/list/search tools into a single list that `server.ts` iterates.

import type { ToolDef } from "./types.js";
import { CREATE_TOOLS } from "./create.js";
import { ARTIFACT_TOOLS } from "./artifact.js";

export { CREATE_TOOLS } from "./create.js";
export { ARTIFACT_TOOLS } from "./artifact.js";
export * from "./types.js";
export * from "./ids.js";

/** Flat list of every artifact tool (create + read/list/search). */
export const ARTIFACT_MCP_TOOLS: ToolDef[] = [
  ...CREATE_TOOLS,
  ...ARTIFACT_TOOLS,
];
