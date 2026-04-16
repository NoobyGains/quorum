// `quorum inbox` — unread artifacts addressed to the current agent.
//
// Output is designed to be prepended to Claude Code (or Codex) context by a
// UserPromptSubmit hook. See docs/hooks.md for the user-facing wiring and
// docs/design.md § Layer 3 for the "between-turn hook injection" rationale.
//
// "Unread" means: created after the per-agent `last_seen` watermark, which
// lives at `<storageRoot>/inbox/<agent>.last_seen` (one file per agent). The
// watermark is advanced only when `--unread` is passed, so ad-hoc inspection
// via `quorum inbox` is non-destructive.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Artifact } from "@quorum/artifacts";
import { Store, storageRoot } from "@quorum/store";

export interface InboxEnv {
  /** Working directory of the project whose state we query. */
  cwd: string;
  /** Home directory override (tests swap for a tmp dir). */
  homeDir: string;
  /** Current instant — injectable so tests can pin "Xm ago" rendering. */
  now: () => Date;
  /** Env-var lookup, so the test harness doesn't inherit process env. */
  getEnv: (key: string) => string | undefined;
}

export function defaultInboxEnv(): InboxEnv {
  return {
    cwd: process.cwd(),
    homeDir: homedir(),
    now: () => new Date(),
    getEnv: (key) => process.env[key],
  };
}

export interface InboxOptions {
  /** Agent whose inbox to read. Default: `QUORUM_AGENT` env var or `claude`. */
  agent?: string;
  /** Only list items strictly newer than the per-agent last_seen watermark. */
  unread?: boolean;
  /** ISO datetime; if present, items at or before this are filtered out. */
  since?: string;
  /** Emit JSON instead of the human-readable text format. */
  json?: boolean;
}

/**
 * Resolve the agent name following the fallback chain:
 *   explicit flag -> QUORUM_AGENT env var -> "claude".
 */
export function resolveAgent(env: InboxEnv, opts: InboxOptions): string {
  return opts.agent ?? env.getEnv("QUORUM_AGENT") ?? "claude";
}

/**
 * Per-agent `last_seen` watermark path.
 *   `<storageRoot>/inbox/<agent>.last_seen`
 */
export function lastSeenPath(
  homeDir: string,
  cwd: string,
  agent: string,
): string {
  return join(storageRoot(cwd, homeDir), "inbox", `${agent}.last_seen`);
}

export function readLastSeen(
  homeDir: string,
  cwd: string,
  agent: string,
): string | null {
  const path = lastSeenPath(homeDir, cwd, agent);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  return raw === "" ? null : raw;
}

export function writeLastSeen(
  homeDir: string,
  cwd: string,
  agent: string,
  isoTimestamp: string,
): void {
  const path = lastSeenPath(homeDir, cwd, agent);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, isoTimestamp + "\n", "utf8");
}

/**
 * Return true if `artifact` is addressed to `me`. Per-type rules:
 *
 *   Question       — `addressed_to` includes me
 *   Review         — reviewer !== me (incoming peer review)
 *   Disagreement   — I'm either thesis_agent or antithesis_agent
 *   Handoff        — from anyone else
 *   everything else — author !== me
 */
export function isAddressedToMe(artifact: Artifact, me: string): boolean {
  switch (artifact.type) {
    case "Question":
      return artifact.addressed_to.includes(me);
    case "Review":
      return artifact.reviewer !== me;
    case "Disagreement":
      return artifact.thesis_agent === me || artifact.antithesis_agent === me;
    case "Handoff":
      return artifact.from !== me;
    default:
      return artifact.author !== me;
  }
}

const TYPE_LABEL: Record<Artifact["type"], string> = {
  Plan: "Plan",
  Claim: "Claim",
  Hypothesis: "Hypothesis",
  Experiment: "Experiment",
  Result: "Result",
  Decision: "Decision",
  Question: "Question",
  Commitment: "Commitment",
  Disagreement: "Disagreement",
  Handoff: "Handoff",
  Review: "Review",
  RiskFlag: "RiskFlag",
};

/**
 * Short human-readable summary fragment for a single artifact line.
 * Intentionally terse — the line is for a hook-injected header, not prose.
 */
export function summarize(artifact: Artifact): string {
  switch (artifact.type) {
    case "Plan":
      return JSON.stringify(artifact.goal);
    case "Question":
      return JSON.stringify(artifact.text);
    case "Review":
      return `${artifact.verdict} on ${artifact.target_commit.slice(0, 7)}`;
    case "Disagreement":
      return `blocks ${artifact.target}`;
    case "Handoff":
      return JSON.stringify(artifact.summary);
    case "Claim":
      return `claims ${artifact.target}`;
    case "Decision":
      return JSON.stringify(artifact.chosen);
    case "Commitment":
      return JSON.stringify(artifact.what);
    case "Hypothesis":
      return JSON.stringify(artifact.statement);
    case "Experiment":
      return JSON.stringify(artifact.method);
    case "Result":
      return `result of ${artifact.experiment_id}`;
    case "RiskFlag":
      return `${artifact.severity}: ${JSON.stringify(artifact.description)}`;
  }
}

/**
 * Human-friendly "2m ago" style offset. Clamps negative offsets to "now".
 * Exported for tests.
 */
export function humanizeAgo(now: Date, then: Date): string {
  const deltaMs = Math.max(0, now.getTime() - then.getTime());
  const secs = Math.floor(deltaMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Pick the authorship label for display. For a Review, "from" is the
 * reviewer (not necessarily the artifact `author`). For a Handoff, "from"
 * is the `from` field. Otherwise `author`.
 */
export function displayFrom(a: Artifact): string {
  if (a.type === "Review") return a.reviewer;
  if (a.type === "Handoff") return a.from;
  return a.author;
}

export interface InboxItem {
  id: string;
  type: Artifact["type"];
  from: string;
  created: string;
  summary: string;
}

export function toItem(a: Artifact): InboxItem {
  return {
    id: a.id,
    type: a.type,
    from: displayFrom(a),
    created: a.created,
    summary: summarize(a),
  };
}

export interface InboxResult {
  agent: string;
  since: string | null;
  items: InboxItem[];
}

/**
 * Query the store for artifacts addressed to `agent` subject to the
 * caller's filters. Pure (no I/O beyond the Store). Sorted newest-first.
 */
export async function collectInbox(
  store: Store,
  env: InboxEnv,
  opts: InboxOptions,
): Promise<InboxResult> {
  const agent = resolveAgent(env, opts);

  // Combine `--since`, `--unread`, and env defaults into a single lower bound.
  // `--since` is an explicit override; when both are supplied, take the later
  // of the two so we never show something older than the caller asked for.
  const bounds: string[] = [];
  if (opts.since !== undefined) bounds.push(opts.since);
  if (opts.unread) {
    const ls = readLastSeen(env.homeDir, env.cwd, agent);
    if (ls !== null) bounds.push(ls);
  }
  const since = bounds.length
    ? bounds.reduce((a, b) => (a > b ? a : b))
    : null;

  // `Store.list({ createdAfter })` is strict-greater-than, matching what we want.
  const all = await store.list(
    since !== null ? { createdAfter: since } : undefined,
  );
  const addressed = all.filter((a) => isAddressedToMe(a, agent));
  // `store.list` already sorts newest-first, but be explicit in case that
  // implementation detail shifts. ISO8601 offset strings sort correctly.
  addressed.sort((a, b) => (a.created < b.created ? 1 : -1));

  return {
    agent,
    since,
    items: addressed.map(toItem),
  };
}

export interface FormatOptions {
  now: Date;
}

/** Format a compact human-readable report. */
export function formatHuman(result: InboxResult, fmt: FormatOptions): string {
  const lines: string[] = [];
  const sinceLabel = result.since ?? "the beginning";
  lines.push(
    `[quorum] ${String(result.items.length)} unread for ${result.agent} since ${sinceLabel}:`,
  );

  // Column widths are derived rather than hard-coded so long ids or names
  // don't collide with the summary column.
  const idW = Math.max(5, ...result.items.map((i) => i.id.length));
  const typeW = Math.max(4, ...result.items.map((i) => TYPE_LABEL[i.type].length));
  const fromW = Math.max(4, ...result.items.map((i) => i.from.length));

  for (const item of result.items) {
    const ago = humanizeAgo(fmt.now, new Date(item.created));
    lines.push(
      `  ${item.id.padEnd(idW)}  ${TYPE_LABEL[item.type].padEnd(typeW)}  from ${item.from.padEnd(fromW)}  ${item.summary}  ${ago}`,
    );
  }
  return lines.join("\n");
}

/** Format as machine-readable JSON (single line, stable key order). */
export function formatJson(result: InboxResult): string {
  return JSON.stringify({
    agent: result.agent,
    since: result.since,
    count: result.items.length,
    items: result.items,
  });
}

export interface RunInboxOptions {
  env?: InboxEnv;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  /** Injectable Store factory for tests. */
  storeFactory?: (cwd: string, homeDir: string) => Store;
  flags?: InboxOptions;
}

function defaultStoreFactory(cwd: string, homeDir: string): Store {
  return new Store(cwd, { homeDir, warn: () => {} });
}

/**
 * Top-level entry for the `inbox` subcommand. Returns an intended exit code.
 * Always 0 except on unexpected errors (I/O failures, schema violations).
 */
export async function runInbox(options: RunInboxOptions = {}): Promise<0 | 1> {
  const env = options.env ?? defaultInboxEnv();
  const log = options.log ?? ((m: string) => console.log(m));
  const err = options.err ?? ((m: string) => console.error(m));
  const flags = options.flags ?? {};
  const storeFactory = options.storeFactory ?? defaultStoreFactory;

  let store: Store;
  try {
    store = storeFactory(env.cwd, env.homeDir);
  } catch (e) {
    err(
      `quorum inbox: failed to open store: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }

  try {
    const result = await collectInbox(store, env, flags);

    if (flags.json) {
      log(formatJson(result));
    } else {
      log(formatHuman(result, { now: env.now() }));
    }

    // Advance the per-agent watermark only if the caller explicitly asked to
    // see unread items — otherwise a plain `quorum inbox` would silently burn
    // through them. Use `now` rather than the newest artifact's `created`
    // timestamp so we also clear anything that arrives between the query and
    // write; the next run will show genuinely fresh items.
    if (flags.unread) {
      writeLastSeen(
        env.homeDir,
        env.cwd,
        result.agent,
        env.now().toISOString(),
      );
    }

    return 0;
  } catch (e) {
    err(
      `quorum inbox: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  } finally {
    await store.close();
  }
}
