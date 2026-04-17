// Combined Store — the public entry point used by CLI, MCP tools, and the
// watchdog. Wires together the immutable git-refs source of truth and the
// derivable SQLite index so callers have a single async API.
//
// Write flow:
//   1. ArtifactSchema.safeParse — reject invalid artifacts at the boundary
//   2. git.write — source of truth; blob + commit + ref
//   3. sqlite.index — derivable query layer. Must succeed; if it throws, the
//      whole write throws so the caller sees the failure synchronously (issue
//      #52). Retries are safe: git.write is idempotent on id and sqlite.index
//      is a DELETE+INSERT in a single transaction. For catastrophic index
//      loss, see `rebuildIndex`.

import { mkdirSync } from "node:fs";

import type { Artifact, ArtifactType } from "@quorum/artifacts";
import { ArtifactSchema } from "@quorum/artifacts";

import { GitRefsStore } from "./git-refs.js";
import { sqlitePath, storageRoot } from "./paths.js";
import { SqliteIndex, type QueryFilter } from "./sqlite-index.js";

export interface StoreOptions {
  /**
   * Override for the home directory — tests pass a tmp dir. Defaults to
   * `os.homedir()`.
   */
  homeDir?: string;
}

export class Store {
  private readonly git: GitRefsStore;
  private readonly sqlite: SqliteIndex;

  constructor(cwd: string, opts: StoreOptions = {}) {
    const root = storageRoot(cwd, opts.homeDir);
    mkdirSync(root, { recursive: true });
    this.git = new GitRefsStore(root);
    this.sqlite = new SqliteIndex(sqlitePath(root));
  }

  /**
   * Validate, persist to git, then index in sqlite. Throws on schema
   * validation failure, git write failure, or sqlite index failure. The
   * caller can retry safely: git.write is idempotent (same id → same ref)
   * and sqlite.index is a single transaction that overwrites any existing
   * row.
   */
  async write(a: Artifact): Promise<void> {
    const parsed = ArtifactSchema.safeParse(a);
    if (!parsed.success) {
      throw new Error(
        `Store.write: invalid artifact: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    const artifact = parsed.data;
    const { sha } = await this.git.write(artifact);
    this.sqlite.index(artifact, sha);
  }

  /**
   * Prefer the sqlite index for point lookups (O(1) vs O(refs)); fall back
   * to git if the index doesn't have the row. This matters during recovery
   * after a sqlite wipe — git is always authoritative.
   */
  async read(id: string): Promise<Artifact | null> {
    const indexed = this.sqlite.get(id);
    if (indexed) return indexed;
    return this.git.read(id);
  }

  /** Index-backed list with optional filters. */
  async list(filter?: QueryFilter): Promise<Artifact[]> {
    return this.sqlite.query(filter);
  }

  /** FTS5 search over artifact bodies. */
  async search(query: string): Promise<Artifact[]> {
    return this.sqlite.search(query);
  }

  /** Convenience passthrough — newest N of a given type. */
  async latestOfType(type: ArtifactType, limit?: number): Promise<Artifact[]> {
    return this.sqlite.latestOfType(type, limit);
  }

  /** Follow a supersession chain forward by one hop. */
  async supersededBy(oldId: string): Promise<Artifact | null> {
    return this.sqlite.supersededBy(oldId);
  }

  /**
   * Write a superseding artifact. Delegates the invariant check to
   * `GitRefsStore.supersede`, then re-indexes. Index failure throws (see
   * `write`).
   */
  async supersede(oldId: string, next: Artifact): Promise<void> {
    const parsed = ArtifactSchema.safeParse(next);
    if (!parsed.success) {
      throw new Error(
        `Store.supersede: invalid artifact: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
    }
    const artifact = parsed.data;
    const { sha } = await this.git.supersede(oldId, artifact);
    this.sqlite.index(artifact, sha);
  }

  /**
   * Walk every ref in git and re-index into sqlite. Intended for catastrophic
   * recovery — e.g., the index file was deleted or corrupted. Rows already
   * in sqlite are overwritten by the DELETE+INSERT in `SqliteIndex.index`.
   * Returns the number of artifacts re-indexed.
   */
  async rebuildIndex(): Promise<number> {
    const entries = await this.git.listAllWithSha();
    for (const { artifact, sha } of entries) {
      this.sqlite.index(artifact, sha);
    }
    return entries.length;
  }

  async close(): Promise<void> {
    this.sqlite.close();
  }
}
