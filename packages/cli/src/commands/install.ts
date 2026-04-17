// `quorum install` — one-command wiring into Claude Code and Codex
// (GitHub issue #59).
//
// Three registration targets, all under the user's home dir:
//   1. ~/.claude.json           — MCP server entry under mcpServers.quorum
//   2. ~/.claude/settings.json  — UserPromptSubmit hook running inbox+presence
//   3. ~/.codex/config.toml     — MCP server entry under [mcp_servers.quorum]
//
// Each write is idempotent: re-running is a no-op. `--uninstall` reverses
// each target individually, matched by a well-known marker ("quorum" key for
// MCP; "_quorumManaged" field on the hook object; "# managed-by: quorum-
// install" comment on the TOML section).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Default absolute path of `packages/mcp-server/dist/index.js` resolved from
 * this file's build location. Overridable via InstallEnv for tests. */
function defaultMcpServerPath(): string {
  // This file compiles to `packages/cli/dist/commands/install.js`. The
  // mcp-server build sits at `packages/mcp-server/dist/index.js`.
  return join(SRC_DIR, "..", "..", "..", "mcp-server", "dist", "index.js");
}

/** Normalize a filesystem path to forward-slash form (safe in JSON and TOML,
 * works on Windows). */
function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

export interface InstallEnv {
  homeDir: string;
  /** Absolute path to the MCP server entrypoint. */
  mcpServerPath: string;
}

export function defaultInstallEnv(): InstallEnv {
  return {
    homeDir: homedir(),
    mcpServerPath: defaultMcpServerPath(),
  };
}

export interface InstallOptions {
  dryRun?: boolean;
  uninstall?: boolean;
  /** Which agent harnesses to (un)install. Default "all". */
  agent?: "claude" | "codex" | "all";
}

export type ActionKind = "create" | "update" | "remove" | "noop";

export interface Action {
  /** File the action targets. */
  file: string;
  kind: ActionKind;
  /** One-line human-readable description. */
  description: string;
  /** Executes the file write. No-op for kind="noop". */
  apply: () => void;
}

// --- Pure string transformers ------------------------------------------------
// Each returns the desired new file contents given the current contents.

const HOOK_COMMAND =
  "cd $CLAUDE_PROJECT_DIR && npx quorum inbox --unread && npx quorum presence";
const TOML_MARKER = "# managed-by: quorum-install";

function parseJsonOrEmpty(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected a top-level JSON object");
  }
  return parsed as Record<string, unknown>;
}

function stringifyJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 2) + "\n";
}

/** Upsert mcpServers.quorum pointing at the MCP server stdio entrypoint.
 * Preserves sibling entries. Idempotent: equal input and output if already
 * correctly configured. */
export function upsertClaudeMcp(
  currentText: string,
  mcpServerAbsPath: string,
): string {
  const obj = parseJsonOrEmpty(currentText);
  const mcp =
    obj.mcpServers && typeof obj.mcpServers === "object" && !Array.isArray(obj.mcpServers)
      ? (obj.mcpServers as Record<string, unknown>)
      : {};
  mcp.quorum = {
    command: "node",
    args: [toForwardSlashes(mcpServerAbsPath)],
  };
  obj.mcpServers = mcp;
  return stringifyJson(obj);
}

/** Remove mcpServers.quorum. Leaves sibling entries (and the empty
 * mcpServers object if nothing else remains) intact. */
export function removeClaudeMcp(currentText: string): string {
  const obj = parseJsonOrEmpty(currentText);
  if (
    obj.mcpServers &&
    typeof obj.mcpServers === "object" &&
    !Array.isArray(obj.mcpServers)
  ) {
    const mcp = obj.mcpServers as Record<string, unknown>;
    if ("quorum" in mcp) {
      delete mcp.quorum;
    }
  }
  return stringifyJson(obj);
}

/** Upsert one hooks.UserPromptSubmit entry tagged with `_quorumManaged: true`.
 * Preserves existing (user-authored) entries. */
export function upsertClaudeHook(currentText: string): string {
  const obj = parseJsonOrEmpty(currentText);
  const hooksRoot =
    obj.hooks && typeof obj.hooks === "object" && !Array.isArray(obj.hooks)
      ? (obj.hooks as Record<string, unknown>)
      : {};
  const existing = Array.isArray(hooksRoot.UserPromptSubmit)
    ? (hooksRoot.UserPromptSubmit as unknown[])
    : [];
  const unrelated = existing.filter(
    (e) => !(typeof e === "object" && e !== null && (e as { _quorumManaged?: unknown })._quorumManaged === true),
  );
  const ours = {
    _quorumManaged: true,
    hooks: [{ type: "command", command: HOOK_COMMAND }],
  };
  hooksRoot.UserPromptSubmit = [...unrelated, ours];
  obj.hooks = hooksRoot;
  return stringifyJson(obj);
}

/** Remove our UserPromptSubmit entry. Leaves user-authored entries. */
export function removeClaudeHook(currentText: string): string {
  const obj = parseJsonOrEmpty(currentText);
  if (
    obj.hooks &&
    typeof obj.hooks === "object" &&
    !Array.isArray(obj.hooks)
  ) {
    const hooksRoot = obj.hooks as Record<string, unknown>;
    if (Array.isArray(hooksRoot.UserPromptSubmit)) {
      hooksRoot.UserPromptSubmit = (hooksRoot.UserPromptSubmit as unknown[]).filter(
        (e) => !(typeof e === "object" && e !== null && (e as { _quorumManaged?: unknown })._quorumManaged === true),
      );
    }
  }
  return stringifyJson(obj);
}

/** Upsert the [mcp_servers.quorum] section, preceded by a managed-by comment
 * so uninstall can find and remove it. Section-level TOML munging — does not
 * parse nested values. Robust against typical user-authored content; may
 * need future work if users author unusual whitespace. */
export function upsertCodexMcp(
  currentText: string,
  mcpServerAbsPath: string,
): string {
  const withoutOurs = removeCodexMcp(currentText);
  const base = withoutOurs.trim();
  const block =
    `${TOML_MARKER}\n` +
    `[mcp_servers.quorum]\n` +
    `command = "node"\n` +
    `args = ["${toForwardSlashes(mcpServerAbsPath)}"]\n`;
  return (base === "" ? block : `${base}\n\n${block}`);
}

/** Remove the [mcp_servers.quorum] section and its preceding managed-by
 * comment. Idempotent: returns input unchanged if section is absent. */
export function removeCodexMcp(currentText: string): string {
  const lines = currentText.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipping) {
      // Continue skipping until the next section header (any `[...]`) or EOF.
      if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
        skipping = false;
        out.push(line);
      }
      // else: drop the line
      continue;
    }
    // Detect the start of our managed block: marker comment immediately
    // followed by our section header. The marker is optional — if the user
    // deleted the comment but kept the section, we still remove the section.
    if (
      line.trim() === TOML_MARKER &&
      /^\s*\[mcp_servers\.quorum\]\s*$/.test(lines[i + 1] ?? "")
    ) {
      skipping = true;
      i += 1; // also skip the section header; the skipping loop handles body
      continue;
    }
    if (/^\s*\[mcp_servers\.quorum\]\s*$/.test(line)) {
      skipping = true;
      continue;
    }
    out.push(line);
  }
  // Collapse runs of blank lines that the removal may have produced.
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n");
}

// --- File-level planning -----------------------------------------------------

function readOrEmpty(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function writeFileWithParents(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

function diffedAction(
  file: string,
  existed: boolean,
  before: string,
  after: string,
  uninstall: boolean,
): Action {
  if (before === after) {
    return {
      file,
      kind: "noop",
      description: uninstall
        ? `${file}: already clean (no Quorum entries)`
        : `${file}: already up to date`,
      apply: () => {
        // nothing
      },
    };
  }
  const kind: ActionKind = !existed
    ? "create"
    : uninstall
      ? "remove"
      : "update";
  const verb = kind === "create" ? "create" : kind === "remove" ? "clean" : "update";
  return {
    file,
    kind,
    description: `${file}: would ${verb} (${after.length - before.length >= 0 ? "+" : ""}${after.length - before.length} bytes)`,
    apply: () => {
      writeFileWithParents(file, after);
    },
  };
}

export function planInstall(env: InstallEnv, opts: InstallOptions = {}): Action[] {
  const agent = opts.agent ?? "all";
  const uninstall = opts.uninstall === true;
  const actions: Action[] = [];

  if (agent === "all" || agent === "claude") {
    // ~/.claude.json — MCP registration
    const claudeJson = join(env.homeDir, ".claude.json");
    const before1 = readOrEmpty(claudeJson);
    const after1 = uninstall
      ? removeClaudeMcp(before1 === "" ? "{}" : before1)
      : upsertClaudeMcp(before1 === "" ? "{}" : before1, env.mcpServerPath);
    actions.push(
      diffedAction(claudeJson, before1 !== "", before1, after1, uninstall),
    );

    // ~/.claude/settings.json — UserPromptSubmit hook
    const settingsJson = join(env.homeDir, ".claude", "settings.json");
    const before2 = readOrEmpty(settingsJson);
    const after2 = uninstall
      ? removeClaudeHook(before2 === "" ? "{}" : before2)
      : upsertClaudeHook(before2 === "" ? "{}" : before2);
    actions.push(
      diffedAction(settingsJson, before2 !== "", before2, after2, uninstall),
    );
  }

  if (agent === "all" || agent === "codex") {
    const codexToml = join(env.homeDir, ".codex", "config.toml");
    const before3 = readOrEmpty(codexToml);
    const after3 = uninstall
      ? removeCodexMcp(before3)
      : upsertCodexMcp(before3, env.mcpServerPath);
    actions.push(
      diffedAction(codexToml, before3 !== "", before3, after3, uninstall),
    );
  }

  return actions;
}

// --- Top-level entry ---------------------------------------------------------

export interface RunInstallOptions {
  env?: InstallEnv;
  opts?: InstallOptions;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
}

export async function runInstall(options: RunInstallOptions = {}): Promise<0 | 1> {
  const env = options.env ?? defaultInstallEnv();
  const opts = options.opts ?? {};
  const log = options.log ?? ((m: string) => console.log(m));
  const err = options.err ?? ((m: string) => console.error(m));

  let actions: Action[];
  try {
    actions = planInstall(env, opts);
  } catch (e) {
    err(`quorum install: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  const label = opts.uninstall ? "Uninstall plan" : "Install plan";
  log(`${label} (dry-run=${opts.dryRun ? "yes" : "no"}):`);
  for (const a of actions) {
    log(`  [${a.kind}] ${a.description}`);
  }

  if (opts.dryRun) {
    return 0;
  }

  let changed = 0;
  let failed = 0;
  for (const a of actions) {
    if (a.kind === "noop") continue;
    try {
      a.apply();
      changed += 1;
    } catch (e) {
      failed += 1;
      err(`quorum install: failed to write ${a.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log(
    failed > 0
      ? `Done with ${failed} failures (${changed} applied).`
      : changed === 0
        ? "Nothing to do — everything already up to date."
        : `Done. ${changed} file(s) updated.`,
  );
  return failed > 0 ? 1 : 0;
}
