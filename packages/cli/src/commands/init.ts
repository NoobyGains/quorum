// `quorum init` — initialize the local Quorum state directory (GitHub issue #18).
//
// Creates `~/.quorum/<hash>/` for the current project, where `<hash>` is the
// first 16 hex chars of sha1(cwd). Writes a `config.json` and an empty
// `state.db` placeholder (the M1 worker for #20 replaces this with a real
// SQLite database). The operation is idempotent — re-running against an
// already-initialized project is a no-op.

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CLI_VERSION = "0.0.0" as const;

export interface InitEnv {
  /** Working directory of the project to initialize. */
  cwd: string;
  /** User home directory (tests swap this for a temp dir). */
  homeDir: string;
  /** ISO timestamp used in `config.json`. Tests may pin this. */
  now: () => string;
}

export function defaultInitEnv(): InitEnv {
  return {
    cwd: process.cwd(),
    homeDir: homedir(),
    now: () => new Date().toISOString(),
  };
}

/**
 * Compute the project hash used to namespace `~/.quorum/<hash>/`.
 */
export function projectHash(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex").slice(0, 16);
}

/**
 * Resolve the absolute directory for the given project cwd.
 */
export function projectStateDir(homeDir: string, cwd: string): string {
  return join(homeDir, ".quorum", projectHash(cwd));
}

export interface InitResult {
  /** Absolute path of the created (or existing) per-project state dir. */
  stateDir: string;
  /** Whether the directory already existed before this run. */
  alreadyInitialized: boolean;
}

export interface ProjectConfig {
  project_path: string;
  created_at: string;
  version: string;
}

/**
 * Perform the filesystem side-effects of `quorum init`. Returns metadata
 * about what happened so the caller can print an appropriate message.
 */
export function initProject(env: InitEnv): InitResult {
  const stateDir = projectStateDir(env.homeDir, env.cwd);
  const configPath = join(stateDir, "config.json");
  const dbPath = join(stateDir, "state.db");

  const alreadyInitialized = existsSync(configPath);
  if (alreadyInitialized) {
    return { stateDir, alreadyInitialized: true };
  }

  mkdirSync(stateDir, { recursive: true });

  const config: ProjectConfig = {
    project_path: env.cwd,
    created_at: env.now(),
    version: CLI_VERSION,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  // Zero-byte placeholder — M1 worker for #20 replaces this with a real
  // SQLite database. Use `openSync`/`closeSync` so we don't accidentally
  // write a byte or trailing newline.
  if (!existsSync(dbPath)) {
    const fd = openSync(dbPath, "w");
    closeSync(fd);
  }

  return { stateDir, alreadyInitialized: false };
}

export interface RunInitOptions {
  env?: InitEnv;
  log?: (msg: string) => void;
}

/**
 * Top-level entry for the `init` subcommand. Always exits 0 — idempotent
 * re-runs are not considered an error.
 */
export async function runInit(options: RunInitOptions = {}): Promise<0> {
  const env = options.env ?? defaultInitEnv();
  // eslint-disable-next-line no-console
  const log = options.log ?? ((msg: string) => console.log(msg));

  const result = initProject(env);
  if (result.alreadyInitialized) {
    log(`Quorum is already initialized for ${env.cwd}`);
  } else {
    log(`Initialized Quorum for ${env.cwd} at ${result.stateDir}`);
  }
  return 0;
}
