#!/usr/bin/env node
// Thin binary entry. Resolves the templates dir relative to this file, then
// hands off to runCli(). Kept intentionally minimal — the testable surface
// lives in cli.ts.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runCli } from "./cli.js";

const here = dirname(fileURLToPath(import.meta.url));
// When running from source: src/index.ts → ../templates
// When running from dist:  dist/index.js → ../templates
// Both resolve to the same absolute path because `templates/` is a sibling of
// `src/` and `dist/` in the package layout.
const templatesDir = resolve(here, "..", "templates");

const exitCode = await runCli({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  templatesDir,
  stdout: (msg) => process.stdout.write(msg.endsWith("\n") ? msg : msg + "\n"),
  stderr: (msg) => process.stderr.write(msg.endsWith("\n") ? msg : msg + "\n"),
});

process.exit(exitCode);
