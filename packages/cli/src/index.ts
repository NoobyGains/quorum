#!/usr/bin/env node
// @quorum/cli — "quorum" command-line interface.
// Entry point: registers subcommands with commander.
// See ROADMAP.md M0 for the specification.

import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";
import { runInbox, type InboxOptions } from "./commands/inbox.js";
import { runInit } from "./commands/init.js";
import { runInstall, type InstallOptions } from "./commands/install.js";
import { runPresence, type PresenceOptions } from "./commands/presence.js";

export const CLI_VERSION = "0.0.0" as const;

/**
 * Build the commander program. Exported so tests can exercise it.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("quorum")
    .description("Quorum coordination CLI")
    .version(CLI_VERSION, "-v, --version", "output the CLI version");

  program
    .command("doctor")
    .description("Print a diagnostics report for the local environment")
    .action(async () => {
      const code = await runDoctor();
      process.exit(code);
    });

  program
    .command("init")
    .description("Initialize Quorum for the current project")
    .action(async () => {
      const code = await runInit();
      process.exit(code);
    });

  program
    .command("inbox")
    .description("Print unread artifacts addressed to the current agent")
    .option("--agent <name>", "agent name (default: $QUORUM_AGENT or 'claude')")
    .option("--unread", "only show items newer than last seen, and advance the watermark")
    .option("--since <iso>", "ISO timestamp lower bound")
    .option("--json", "emit JSON instead of human-readable output")
    .action(async (opts: InboxOptions) => {
      const code = await runInbox({ flags: opts });
      process.exit(code);
    });

  program
    .command("presence")
    .description("Print which agents have been active recently in this project")
    .option("--json", "emit JSON instead of human-readable output")
    .action(async (opts: PresenceOptions) => {
      const code = await runPresence({ flags: opts });
      process.exit(code);
    });

  program
    .command("install")
    .description(
      "Register Quorum's MCP server and UserPromptSubmit hook with Claude Code and Codex",
    )
    .option("--dry-run", "print the planned changes without writing")
    .option("--uninstall", "reverse a prior install")
    .option(
      "--agent <which>",
      "scope: claude | codex | all",
      (value: string) => {
        if (value !== "claude" && value !== "codex" && value !== "all") {
          throw new Error(
            `--agent must be one of: claude, codex, all (got ${value})`,
          );
        }
        return value;
      },
      "all" as InstallOptions["agent"],
    )
    .action(
      async (opts: {
        dryRun?: boolean;
        uninstall?: boolean;
        agent?: InstallOptions["agent"];
      }) => {
        const code = await runInstall({
          opts: {
            dryRun: opts.dryRun,
            uninstall: opts.uninstall,
            agent: opts.agent,
          },
        });
        process.exit(code);
      },
    );

  return program;
}

/**
 * Main entry point invoked when the CLI is executed directly.
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(argv);
}

// Only run main when this module is the entry point. Using process.argv[1]
// rather than import.meta.url keeps the check compatible with test runners
// that may import this module.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  /[\\/]quorum(\.js|\.cjs|\.mjs)?$|[\\/]cli[\\/]dist[\\/]index\.js$/i.test(
    process.argv[1],
  );

if (invokedDirectly) {
  main().catch((err) => {

    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
