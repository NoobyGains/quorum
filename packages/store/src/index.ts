// @quorum/store — git-refs source of truth + SQLite index.
// Public surface for CLI, MCP tools, and the watchdog.

export { Store, type StoreOptions } from "./store.js";
export { GitRefsStore, refForArtifact } from "./git-refs.js";
export { SqliteIndex, type QueryFilter } from "./sqlite-index.js";
export * from "./paths.js";

export const STORE_PACKAGE_VERSION = "0.0.1" as const;
