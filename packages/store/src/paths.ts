// Storage root resolution — mirrors the algorithm used by `@quorum/cli init`
// so that a project's state directory is the same regardless of which
// package creates or reads it. Kept as pure string/path math; no I/O here.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Compute the project hash used to namespace `~/.quorum/<hash>/`.
 *
 * sha1(cwd), first 16 hex chars. Must match `@quorum/cli`'s `projectHash`
 * so both packages resolve to the same directory for the same project.
 */
export function projectHash(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex").slice(0, 16);
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

/**
 * Path of the bare git repository that holds artifact blobs.
 * `<storageRoot>/store.git`.
 */
export function gitRepoPath(storageRootDir: string): string {
  return join(storageRootDir, "store.git");
}

/**
 * Path of the SQLite index file. `<storageRoot>/index.db`.
 */
export function sqlitePath(storageRootDir: string): string {
  return join(storageRootDir, "index.db");
}
