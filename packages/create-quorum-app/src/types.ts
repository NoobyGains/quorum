// Shared interfaces for create-quorum-app. Parallel build agents import these
// so their files have a common contract and can't drift apart.

/** Options passed into the pure scaffold() function. */
export interface ScaffoldOptions {
  /** Absolute path to the directory that will be created. Must not already exist unless `overwrite` is true. */
  targetDir: string;
  /** App name — substituted into the template's package.json `name` field in place of `__APP_NAME__`. */
  appName: string;
  /** Absolute path to the template source tree (e.g. `.../templates/nextjs`). */
  templateDir: string;
  /** If true, writing into a non-empty dir is allowed. Defaults to false. */
  overwrite?: boolean;
}

export interface ScaffoldResult {
  /** Relative paths (POSIX-style, under targetDir) of every file created. */
  createdFiles: string[];
}

/** Options passed into runCli() — separated from process.* so tests can stub them. */
export interface CliOptions {
  /** Command-line args AFTER the binary name. e.g. for `create-quorum-app my-thing`, pass `["my-thing"]`. */
  args: readonly string[];
  /** Working directory. Target dir is resolved relative to this. */
  cwd: string;
  /** Absolute path to the templates root (contains `nextjs/` subdir). */
  templatesDir: string;
  /** stdout writer. Tests capture with `(s) => buf.push(s)`. */
  stdout: (msg: string) => void;
  /** stderr writer. */
  stderr: (msg: string) => void;
  /** Command runner for `git init` etc. — injected so tests can stub. Receives cmd + args + cwd, returns exit code. */
  run?: (cmd: string, args: readonly string[], cwd: string) => Promise<number>;
}

/** Exit code returned by runCli. 0 on success, non-zero on validation or runtime failure. */
export type ExitCode = 0 | 1 | 2;
