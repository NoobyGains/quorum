// `quorum presence` — who's active in the current project.
//
// Presence isn't a first-class artifact (yet). For M1 we approximate it by
// grouping the most recent artifact per `author` within a sliding window
// (default 15 min). When the watchdog lands in a later milestone it will
// publish real Presence events; this command will adapt then.

import { homedir } from "node:os";

import type { Artifact } from "@quorum/artifacts";
import { Store } from "@quorum/store";

/** Default lookback window — artifacts newer than this are "online". */
export const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

export interface PresenceEnv {
  /** Working directory of the project whose state we query. */
  cwd: string;
  /** Home directory override (tests swap for a tmp dir). */
  homeDir: string;
  /** Current instant — injectable so tests can pin windowing. */
  now: () => Date;
}

export function defaultPresenceEnv(): PresenceEnv {
  return {
    cwd: process.cwd(),
    homeDir: homedir(),
    now: () => new Date(),
  };
}

export interface PresenceOptions {
  /** Emit JSON instead of human-readable text. */
  json?: boolean;
  /** Override the default 15-minute window. */
  windowMs?: number;
}

export interface PresenceEntry {
  agent: string;
  lastActive: string;
  lastArtifactId: string;
  lastArtifactType: Artifact["type"];
}

export interface PresenceResult {
  entries: PresenceEntry[];
  windowMs: number;
  now: string;
}

/**
 * For presence we consider the visible `from` identity rather than raw
 * `author` — for a Handoff, `from` is the acting agent even if the artifact
 * author is the orchestrator. This matches the inbox command.
 */
function actor(a: Artifact): string {
  if (a.type === "Handoff") return a.from;
  if (a.type === "Review") return a.reviewer;
  return a.author;
}

function actionLabel(a: Artifact): string {
  switch (a.type) {
    case "Plan":
      return `wrote ${a.id}`;
    case "Claim":
      return `claimed ${a.target}`;
    case "Review":
      return `reviewed ${a.target_plan}`;
    case "Disagreement":
      return `${a.status === "resolved" ? "closed" : "opened"} ${a.id}`;
    case "Handoff":
      return `handed off ${a.id}`;
    case "Decision":
      return `decided ${a.id}`;
    case "Commitment":
      return `committed ${a.id}`;
    case "Question":
      return `asked ${a.id}`;
    case "Hypothesis":
      return `hypothesized ${a.id}`;
    case "Experiment":
      return `proposed ${a.id}`;
    case "Result":
      return `observed ${a.id}`;
    case "RiskFlag":
      return `flagged ${a.target}`;
  }
}

/** Format a short "Ns/Nm/Nh ago" label. */
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
 * Walk recent artifacts and pick the most recent per actor.
 * Exported for tests.
 */
export async function collectPresence(
  store: Store,
  env: PresenceEnv,
  opts: PresenceOptions = {},
): Promise<PresenceResult> {
  const now = env.now();
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const cutoff = new Date(now.getTime() - windowMs).toISOString();

  const recent = await store.list({ createdAfter: cutoff });

  const byActor = new Map<string, Artifact>();
  for (const a of recent) {
    const who = actor(a);
    const prev = byActor.get(who);
    if (!prev || prev.created < a.created) {
      byActor.set(who, a);
    }
  }

  const entries: PresenceEntry[] = Array.from(byActor.entries())
    .map(([agent, a]) => ({
      agent,
      lastActive: a.created,
      lastArtifactId: a.id,
      lastArtifactType: a.type,
    }))
    .sort((x, y) => (x.lastActive < y.lastActive ? 1 : -1));

  return { entries, windowMs, now: now.toISOString() };
}

/** Format a compact human-readable report. */
export function formatHuman(result: PresenceResult, now: Date): string {
  if (result.entries.length === 0) {
    return "[quorum] nobody active in the last window";
  }
  const lines = ["[quorum] online:"];
  const agentW = Math.max(5, ...result.entries.map((e) => e.agent.length));
  for (const e of result.entries) {
    const ago = humanizeAgo(now, new Date(e.lastActive));
    // Cheap reconstruction of a short action label from id + type; `collectPresence`
    // tracks only id + type to keep the result serializable and storage-light.
    lines.push(
      `  ${e.agent.padEnd(agentW)}  last active ${ago}  (last action: ${labelFromEntry(e)})`,
    );
  }
  return lines.join("\n");
}

function labelFromEntry(e: PresenceEntry): string {
  // Must stay consistent with `actionLabel` above for the subset of info
  // we retain in `PresenceEntry`. Fall back to `<type> <id>` where we don't
  // have enough info (targets, reviewers, etc.).
  switch (e.lastArtifactType) {
    case "Plan":
      return `wrote ${e.lastArtifactId}`;
    case "Disagreement":
      return `touched ${e.lastArtifactId}`;
    case "Handoff":
      return `handed off ${e.lastArtifactId}`;
    default:
      return `${e.lastArtifactType} ${e.lastArtifactId}`;
  }
}

export function formatJson(result: PresenceResult): string {
  return JSON.stringify({
    now: result.now,
    windowMs: result.windowMs,
    online: result.entries,
  });
}

export interface RunPresenceOptions {
  env?: PresenceEnv;
  log?: (msg: string) => void;
  err?: (msg: string) => void;
  storeFactory?: (cwd: string, homeDir: string) => Store;
  flags?: PresenceOptions;
}

function defaultStoreFactory(cwd: string, homeDir: string): Store {
  return new Store(cwd, { homeDir });
}

/** Top-level entry for the `presence` subcommand. Always exits 0 on success. */
export async function runPresence(
  options: RunPresenceOptions = {},
): Promise<0 | 1> {
  const env = options.env ?? defaultPresenceEnv();
  const log = options.log ?? ((m: string) => console.log(m));
  const err = options.err ?? ((m: string) => console.error(m));
  const flags = options.flags ?? {};
  const storeFactory = options.storeFactory ?? defaultStoreFactory;

  let store: Store;
  try {
    store = storeFactory(env.cwd, env.homeDir);
  } catch (e) {
    err(
      `quorum presence: failed to open store: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }

  try {
    const result = await collectPresence(store, env, flags);
    if (flags.json) {
      log(formatJson(result));
    } else {
      log(formatHuman(result, env.now()));
    }
    return 0;
  } catch (e) {
    err(
      `quorum presence: ${e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  } finally {
    await store.close();
  }
}

// Re-export `actionLabel` just in case downstream consumers want a long-form
// label; keeps the humanize/format logic discoverable.
export { actionLabel };
