// `quorum doctor` — environment diagnostics (GitHub issue #12).
//
// Runs a series of checks against the local environment and prints a
// human-readable report. Critical checks contribute to the exit code;
// optional checks only emit warnings.

import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  /** Short label shown in the report. */
  label: string;
  /** One-line human-readable detail message. */
  message: string;
  /** Outcome of the check. */
  status: CheckStatus;
  /** Only `ok`/`fail` affect the exit code. `warn` does not. */
  critical: boolean;
}

/**
 * Async command runner injected into check functions so tests can stub it.
 * Resolves to the process exit code (0 on success) plus captured stdout.
 * Rejects only on spawn-level failures (e.g. command not found) — in that
 * case the Error has an ENOENT-ish code on `.code`.
 */
export interface CommandRunner {
  (
    cmd: string,
    args: readonly string[],
    options?: SpawnOptions,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

/**
 * Filesystem probe injected for testability.
 */
export interface FsProbe {
  exists(path: string): boolean;
}

export interface DoctorEnv {
  /** Node version string, e.g. "v20.10.0". */
  nodeVersion: string;
  /** User home directory — the `.quorum` state dir lives here. */
  homeDir: string;
  run: CommandRunner;
  fs: FsProbe;
}

const defaultRun: CommandRunner = (cmd, args, options) =>
  new Promise((resolve, reject) => {
    // Windows PATH entries for tools installed via npm (pnpm, etc.) are
    // .cmd shims with no .exe sibling. Node's spawn without a shell only
    // resolves .exe on Windows, so those binaries look "missing" otherwise.
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });

const defaultFs: FsProbe = {
  exists: (path: string) => existsSync(path),
};

export function defaultDoctorEnv(): DoctorEnv {
  return {
    nodeVersion: process.version,
    homeDir: homedir(),
    run: defaultRun,
    fs: defaultFs,
  };
}

/**
 * Parse a Node version string ("v20.10.0") into a major integer.
 */
export function parseNodeMajor(version: string): number {
  const match = /^v?(\d+)\./.exec(version);
  if (!match) return 0;
  return Number.parseInt(match[1], 10);
}

// Exported for integration testing only — exercises the real child_process
// spawn path in doctor.real-spawn.test.ts. Not part of the public API.
export async function probeBinary(
  run: CommandRunner,
  cmd: string,
  args: readonly string[] = ["--version"],
): Promise<{ available: boolean; version: string }> {
  try {
    const result = await run(cmd, args);
    if (result.exitCode === 0) {
      const firstLine = (result.stdout || result.stderr || "")
        .split(/\r?\n/)[0]
        ?.trim();
      return { available: true, version: firstLine ?? "" };
    }
    return { available: false, version: "" };
  } catch {
    return { available: false, version: "" };
  }
}

/**
 * Run all diagnostic checks. Returns the ordered result list.
 */
export async function runChecks(env: DoctorEnv): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // Node version
  const major = parseNodeMajor(env.nodeVersion);
  results.push({
    label: "Node.js >= 20",
    message:
      major >= 20
        ? `found ${env.nodeVersion}`
        : `found ${env.nodeVersion} (need >= 20)`,
    status: major >= 20 ? "ok" : "fail",
    critical: true,
  });

  // pnpm
  const pnpm = await probeBinary(env.run, "pnpm");
  results.push({
    label: "pnpm available",
    message: pnpm.available ? `pnpm ${pnpm.version}` : "pnpm not found on PATH",
    status: pnpm.available ? "ok" : "fail",
    critical: true,
  });

  // git
  const git = await probeBinary(env.run, "git");
  results.push({
    label: "git available",
    message: git.available ? git.version : "git not found on PATH",
    status: git.available ? "ok" : "fail",
    critical: true,
  });

  // gh CLI
  const gh = await probeBinary(env.run, "gh");
  results.push({
    label: "gh CLI available",
    message: gh.available ? gh.version : "gh not found on PATH",
    status: gh.available ? "ok" : "fail",
    critical: true,
  });

  // claude CLI (optional)
  const claude = await probeBinary(env.run, "claude");
  results.push({
    label: "claude CLI available (optional)",
    message: claude.available
      ? claude.version || "present"
      : "claude not found on PATH — optional, skipping",
    status: claude.available ? "ok" : "warn",
    critical: false,
  });

  // codex CLI (optional)
  const codex = await probeBinary(env.run, "codex");
  results.push({
    label: "codex CLI available (optional)",
    message: codex.available
      ? codex.version || "present"
      : "codex not found on PATH — optional, skipping",
    status: codex.available ? "ok" : "warn",
    critical: false,
  });

  // rustup (optional) — needed for the watchdog daemon
  const rustup = await probeBinary(env.run, "rustup");
  results.push({
    label: "rustup available (optional)",
    message: rustup.available
      ? rustup.version || "present"
      : "rustup not found on PATH — install from https://rustup.rs if you plan to work on the watchdog daemon",
    status: rustup.available ? "ok" : "warn",
    critical: false,
  });

  // cargo (optional) — ships with rustup toolchain
  const cargo = await probeBinary(env.run, "cargo");
  results.push({
    label: "cargo available (optional)",
    message: cargo.available
      ? cargo.version || "present"
      : "cargo not found on PATH — install via rustup from https://rustup.rs if you plan to work on the watchdog daemon",
    status: cargo.available ? "ok" : "warn",
    critical: false,
  });

  // Inside a git repo?
  let insideRepo = false;
  try {
    const r = await env.run("git", ["rev-parse", "--is-inside-work-tree"]);
    insideRepo = r.exitCode === 0 && r.stdout.trim() === "true";
  } catch {
    insideRepo = false;
  }
  results.push({
    label: "cwd inside a git repo",
    message: insideRepo
      ? "yes"
      : "current working directory is not inside a git repository",
    status: insideRepo ? "ok" : "fail",
    critical: true,
  });

  // ~/.quorum state dir
  const stateDir = join(env.homeDir, ".quorum");
  const stateDirExists = env.fs.exists(stateDir);
  results.push({
    label: "~/.quorum state dir",
    message: stateDirExists
      ? `present at ${stateDir}`
      : `NOT YET INITIALIZED (run 'quorum init')`,
    status: stateDirExists ? "ok" : "warn",
    critical: false,
  });

  return results;
}

function prefixFor(status: CheckStatus): string {
  switch (status) {
    case "ok":
      return "\u2705"; // ✅
    case "warn":
      return "\u26a0\ufe0f"; // ⚠️
    case "fail":
      return "\u274c"; // ❌
  }
}

/**
 * Format a set of results into the printable report text (no trailing newline).
 */
export function formatReport(results: readonly CheckResult[]): string {
  const lines = results.map(
    (r) => `${prefixFor(r.status)} ${r.label}: ${r.message}`,
  );
  const failed = results.filter(
    (r) => r.critical && r.status === "fail",
  ).length;
  const summary =
    failed === 0
      ? "All critical checks passed"
      : `${failed} critical checks failed`;
  lines.push("");
  lines.push(summary);
  return lines.join("\n");
}

/**
 * Compute the exit code for a result set: 0 when every critical check passed,
 * 1 if any critical check failed. Warnings never fail the command.
 */
export function exitCodeFor(results: readonly CheckResult[]): 0 | 1 {
  return results.some((r) => r.critical && r.status === "fail") ? 1 : 0;
}

export interface RunDoctorOptions {
  env?: DoctorEnv;
  log?: (msg: string) => void;
}

/**
 * Top-level entry point for the `doctor` subcommand. Returns the intended
 * exit code rather than calling `process.exit` so that tests (and the
 * commander wiring) can decide what to do with it.
 */
export async function runDoctor(options: RunDoctorOptions = {}): Promise<0 | 1> {
  const env = options.env ?? defaultDoctorEnv();
   
  const log = options.log ?? ((msg: string) => console.log(msg));
  const results = await runChecks(env);
  log(formatReport(results));
  return exitCodeFor(results);
}
