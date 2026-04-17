// SQLite index for artifact queries + FTS5. Issue #20.
//
// Git is the source of truth (see git-refs.ts). This file is the derivable
// query layer: `index(artifact, sha)` writes a row; callers use `get`,
// `query`, `search`, `latestOfType`, and `supersededBy` to ask questions
// that would require O(refs) git walks if we only had the git store.
//
// Schema + triggers are created eagerly in the constructor; they are all
// `IF NOT EXISTS` so opening an existing database is a no-op.

import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

import type { Artifact, ArtifactType } from "@quorum/artifacts";
import { ArtifactSchema } from "@quorum/artifacts";
import Database, { type Database as SqliteDatabase } from "better-sqlite3";

/**
 * Schema matches the plan in issue #20. We use INSERT OR REPLACE for idempotent
 * re-indexing: if a downstream watchdog or backfill replays writes, we don't
 * want to crash on unique-key collisions.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  author      TEXT NOT NULL,
  created     TEXT NOT NULL,
  project     TEXT NOT NULL,
  supersedes  TEXT,
  json        TEXT NOT NULL,
  git_sha     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_type       ON artifacts(type);
CREATE INDEX IF NOT EXISTS idx_artifacts_author     ON artifacts(author);
CREATE INDEX IF NOT EXISTS idx_artifacts_created    ON artifacts(created);
CREATE INDEX IF NOT EXISTS idx_artifacts_supersedes ON artifacts(supersedes);

CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
  id UNINDEXED,
  type UNINDEXED,
  body,
  content='artifacts',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS artifacts_ai AFTER INSERT ON artifacts BEGIN
  INSERT INTO artifacts_fts(rowid, id, type, body)
  VALUES (new.rowid, new.id, new.type, new.json);
END;

CREATE TRIGGER IF NOT EXISTS artifacts_ad AFTER DELETE ON artifacts BEGIN
  INSERT INTO artifacts_fts(artifacts_fts, rowid, id, type, body)
  VALUES ('delete', old.rowid, old.id, old.type, old.json);
END;
`;

interface ArtifactRow {
  id: string;
  type: string;
  author: string;
  created: string;
  project: string;
  supersedes: string | null;
  json: string;
  git_sha: string;
}

function rowToArtifact(row: ArtifactRow): Artifact | null {
  try {
    const parsed = ArtifactSchema.safeParse(JSON.parse(row.json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Filter shape for `query`. All fields are optional and conjoined as AND.
 * `createdAfter` compares lexicographically — safe because artifact `created`
 * values are Z-only (issue #56) AND callers are required to pass a Z-only
 * cutoff. Non-Z inputs here would re-introduce the same ordering bug the
 * schema tightening fixed, so we validate at the query boundary too.
 */
export interface QueryFilter {
  type?: ArtifactType;
  author?: string;
  createdAfter?: string;
  limit?: number;
}

/** Matches `YYYY-MM-DDTHH:MM:SS(.sss)?Z` — same shape Zod's .datetime() accepts. */
const Z_ONLY_ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function assertZOnlyCutoff(value: string): void {
  if (!Z_ONLY_ISO.test(value)) {
    throw new TypeError(
      `createdAfter must be a Z-suffixed ISO-8601 timestamp, got ${JSON.stringify(value)}`,
    );
  }
}

export class SqliteIndex {
  private readonly db: SqliteDatabase;

  constructor(path: string) {
    // Ensure the parent dir exists. `Database` will create the file itself
    // but will fail if the directory is missing.
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    // WAL is the sensible default for a long-lived queryable index; we
    // never hold a writer open while reading.
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * Upsert an artifact row. Triggers keep FTS5 in sync. To handle re-indexing
   * cleanly we DELETE first (so the AFTER DELETE trigger removes the old FTS
   * row) and then INSERT, rather than relying on INSERT OR REPLACE which
   * would skip the trigger in some SQLite versions.
   */
  index(artifact: Artifact, gitSha: string): void {
    const json = JSON.stringify(artifact);
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM artifacts WHERE id = ?").run(artifact.id);
      this.db
        .prepare(
          `INSERT INTO artifacts (id, type, author, created, project, supersedes, json, git_sha)
           VALUES (@id, @type, @author, @created, @project, @supersedes, @json, @git_sha)`,
        )
        .run({
          id: artifact.id,
          type: artifact.type,
          author: artifact.author,
          created: artifact.created,
          project: artifact.project,
          supersedes: artifact.supersedes,
          json,
          git_sha: gitSha,
        });
    });
    tx();
  }

  get(id: string): Artifact | null {
    const row = this.db
      .prepare("SELECT * FROM artifacts WHERE id = ?")
      .get(id) as ArtifactRow | undefined;
    return row ? rowToArtifact(row) : null;
  }

  query(filter: QueryFilter = {}): Artifact[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.type !== undefined) {
      clauses.push("type = @type");
      params.type = filter.type;
    }
    if (filter.author !== undefined) {
      clauses.push("author = @author");
      params.author = filter.author;
    }
    if (filter.createdAfter !== undefined) {
      assertZOnlyCutoff(filter.createdAfter);
      clauses.push("created > @createdAfter");
      params.createdAfter = filter.createdAfter;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filter.limit !== undefined ? `LIMIT ${Math.max(0, Math.floor(filter.limit))}` : "";
    const sql = `SELECT * FROM artifacts ${where} ORDER BY created DESC ${limit}`;
    const rows = this.db.prepare(sql).all(params) as ArtifactRow[];
    return rows
      .map(rowToArtifact)
      .filter((a): a is Artifact => a !== null);
  }

  /**
   * FTS5 search over the serialized artifact JSON body. `fts` is passed
   * straight to `MATCH`; callers may use FTS5 operators (e.g. `foo AND bar`,
   * prefix `foo*`).
   */
  search(fts: string): Artifact[] {
    const rows = this.db
      .prepare(
        `SELECT a.* FROM artifacts a
         JOIN artifacts_fts f ON f.rowid = a.rowid
         WHERE artifacts_fts MATCH ?
         ORDER BY a.created DESC`,
      )
      .all(fts) as ArtifactRow[];
    return rows
      .map(rowToArtifact)
      .filter((a): a is Artifact => a !== null);
  }

  latestOfType(type: ArtifactType, limit = 50): Artifact[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM artifacts WHERE type = ? ORDER BY created DESC LIMIT ?`,
      )
      .all(type, Math.max(0, Math.floor(limit))) as ArtifactRow[];
    return rows
      .map(rowToArtifact)
      .filter((a): a is Artifact => a !== null);
  }

  /**
   * Return the artifact (if any) whose `supersedes` points at `oldId`.
   * There is no DB-level uniqueness constraint on supersedes since an
   * artifact *could* theoretically have multiple successors in adversarial
   * histories; we return the most recent one.
   */
  supersededBy(oldId: string): Artifact | null {
    const row = this.db
      .prepare(
        `SELECT * FROM artifacts WHERE supersedes = ? ORDER BY created DESC LIMIT 1`,
      )
      .get(oldId) as ArtifactRow | undefined;
    return row ? rowToArtifact(row) : null;
  }

  close(): void {
    this.db.close();
  }
}
