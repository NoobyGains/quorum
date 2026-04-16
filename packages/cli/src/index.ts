#!/usr/bin/env node
// @quorum/cli — "quorum" command-line interface.
// Entry point: registers subcommands with commander.
// See ROADMAP.md M0 for the specification.

import { Command } from "commander";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";

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
