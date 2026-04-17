// `create-quorum-app` CLI entrypoint. Validates args, delegates to scaffold(),
// initializes a git repo, and prints next-step guidance. Pure function over
// injected stdio/runner so tests can stub them without touching process.*.

import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { scaffold } from "./scaffold.js";
import type { CliOptions, ExitCode } from "./types.js";

const APP_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

// Reserved on Windows regardless of extension. Directory creation with any
// of these names fails or produces an unusable path. Keep lowercased —
// callers match against a lowercased appName.
const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

const defaultRun = (
  cmd: string,
  args: readonly string[],
  cwd: string,
): Promise<number> =>
  new Promise((resolvePromise, reject) => {
    // Windows PATH entries for git/pnpm are often .cmd shims, which Node's
    // spawn can only resolve when `shell: true`.
    const child = spawn(cmd, args, {
      cwd,
      stdio: "ignore",
      shell: process.platform === "win32",
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolvePromise(code ?? 0));
  });

export async function runCli(opts: CliOptions): Promise<ExitCode> {
  const { args, cwd, templatesDir, stdout, stderr } = opts;
  const runner = opts.run ?? defaultRun;

  if (args.length === 0) {
    stderr("Usage: create-quorum-app <app-name>");
    return 2;
  }
  if (args.length > 1) {
    stderr(`Expected exactly one argument (app name), got: ${args.length}`);
    return 2;
  }

  const appName = args[0]!;
  if (!APP_NAME_PATTERN.test(appName)) {
    stderr(
      `invalid app name: ${appName}. must match ${APP_NAME_PATTERN.toString()}`,
    );
    return 2;
  }
  if (WINDOWS_RESERVED_NAMES.has(appName)) {
    stderr(
      `invalid app name: ${appName}. reserved on Windows — pick another name`,
    );
    return 2;
  }

  const targetDir = resolve(cwd, appName);
  const templateDir = join(templatesDir, "nextjs");

  try {
    await scaffold({ targetDir, appName, templateDir });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(msg);
    return 1;
  }

  let gitOk = true;
  try {
    const code = await runner("git", ["init", "--quiet"], targetDir);
    if (code !== 0) {
      gitOk = false;
      stderr(`git init failed (exit ${code}); continuing without git`);
    }
  } catch (err) {
    gitOk = false;
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`git init failed (${msg}); continuing without git`);
  }

  stdout(`\u2713 Created ${appName}/`);
  if (gitOk) {
    stdout("\u2713 Initialized git repo");
  }
  stdout("");
  stdout("Next steps:");
  stdout(`  cd ${appName}`);
  stdout("  pnpm install");
  stdout("  pnpm dev");
  stdout("");
  stdout(
    "Quorum CLI setup (optional, if you've installed @quorum/cli): quorum install",
  );

  return 0;
}
