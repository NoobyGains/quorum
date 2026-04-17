// Storage root resolution. The canonical form of a project path is what
// `projectHash` hashes — two Windows paths that point at the same repo via
// junction or differ only by casing must produce the same hash, otherwise
// `~/.quorum/<hash>` splits state across phantom buckets (issue #53).

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonicalize a project path so equivalent Windows variants (junction,
 * drive-letter casing, forward vs. backslash separators, trailing slash)
 * all resolve to the same string. Does light I/O (`realpathSync.native`)
 * to chase symlinks and junctions; on ENOENT or similar, falls back to
 * pure string normalization so callers with synthetic paths (tests,
 * uninitialized dirs) still get a stable answer.
 */
export function canonicalizeProjectPath(cwd: string): string {
  let p = cwd;
  try {
    // `.native` on Windows follows junctions and returns filesystem casing;
    // on POSIX it delegates to the regular realpath. If the path doesn't
    // exist, we swallow and keep the input — pure normalization below.
    p = realpathSync.native(p);
  } catch {
    // path unresolvable — fall through to string normalization.
  }
  // Normalize separators and strip any trailing separators.
  p = p.replace(/\\/g, "/").replace(/\/+$/, "");
  // Lowercase a drive letter if present (Windows paths only).
  if (/^[A-Za-z]:/.test(p)) {
    p = p[0].toLowerCase() + p.slice(1);
  }
  return p;
}

/**
 * Project hash used to namespace `~/.quorum/<hash>/`. 16 hex chars of
 * sha1 over the canonicalized path — stable across Windows junction /
 * casing / separator variants. Exported so other packages (CLI, watchdog)
 * can derive the same directory without duplicating the algorithm.
 */
export function projectHash(cwd: string): string {
  return createHash("sha1")
    .update(canonicalizeProjectPath(cwd))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Resolve the absolute storage root for a project: `~/.quorum/<hash>/`.
 *
 * `homeDirOverride` lets tests swap in a temp dir without touching `$HOME`.
 */
export function storageRoot(cwd: string, homeDirOverride?: string): string {
  const home = homeDirOverride ?? homedir();
  return join(home, ".quorum", projectHash(cwd));
}

/** Filename of the bare git repo inside a state dir. */
export const GIT_REPO_DIRNAME = "store.git" as const;

/**
 * Filename of the SQLite index file inside a state dir. Exported so that
 * `@quorum/cli` (and any future watchdog) can reference the same name the
 * store opens (issue #57 — init used to create a `state.db` placeholder
 * that the store's `index.db` never saw).
 */
export const INDEX_DB_FILENAME = "index.db" as const;

/** Path of the bare git repository that holds artifact blobs. */
export function gitRepoPath(storageRootDir: string): string {
  return join(storageRootDir, GIT_REPO_DIRNAME);
}

/** Path of the SQLite index file. */
export function sqlitePath(storageRootDir: string): string {
  return join(storageRootDir, INDEX_DB_FILENAME);
}
