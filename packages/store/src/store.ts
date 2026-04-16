// Combined Store — the public entry point used by CLI, MCP tools, and the
// watchdog. Wires together the immutable git-refs source of truth and the
// derivable SQLite index so callers have a single async API.
//
// Write flow:
//   1. ArtifactSchema.safeParse — reject invalid artifacts at the boundary
//   2. git.write — source of truth; blob + commit + ref
//   3. sqlite.index — derivable query layer. Failures here are *logged*,
//      not thrown, because the index can always be rebuilt from git (see
//      issue #20's "sqlite is a cache" note).

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
  /**
   * Sink for non-fatal warnings (currently: sqlite-index failures during
   * write). Defaults to `console.warn`.
   */
  warn?: (msg: string) => void;
}

export class Store {
  private readonly git: GitRefsStore;
  private readonly sqlite: SqliteIndex;
  private readonly warn: (msg: string) => void;

  constructor(cwd: string, opts: StoreOptions = {}) {
    const root = storageRoot(cwd, opts.homeDir);
    mkdirSync(root, { recursive: true });
    this.git = new GitRefsStore(root);
    this.sqlite = new SqliteIndex(sqlitePath(root));

    this.warn = opts.warn ?? ((msg: string) => console.warn(msg));
  }

  /**
   * Validate, persist to git, then index in sqlite. Throws if the artifact
   * fails schema validation or if the git write fails. A sqlite failure is
   * logged but does not roll back the git write — git is the source of
   * truth; the index can be rebuilt.
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
    try {
      this.sqlite.index(artifact, sha);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.warn(`sqlite index failed for ${artifact.id}: ${msg}`);
    }
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
   * `GitRefsStore.supersede`, then re-indexes.
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
    try {
      this.sqlite.index(artifact, sha);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.warn(`sqlite index failed for ${artifact.id}: ${msg}`);
    }
  }

  async close(): Promise<void> {
    this.sqlite.close();
  }
}
