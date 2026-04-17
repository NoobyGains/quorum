import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createHandoff,
  createPlan,
  createReview,
  type Artifact,
  type Handoff,
  type Plan,
  type Review,
} from "@quorum/artifacts";
import { Store } from "@quorum/store";

import {
  collectPresence,
  formatHuman,
  formatJson,
  humanizeAgo,
  runPresence,
  type PresenceEnv,
} from "./presence.js";

const PROJECT = "quorum-presence-test";
const CWD = "/fake/project/presence-test";

function makePlan(id: string, overrides: Partial<Plan> = {}): Plan {
  return createPlan({
    id,
    author: "claude",
    project: PROJECT,
    goal: "goal",
    approach: "approach",
    files_touched: [],
    assumptions: [],
    confidence: 0.8,
    blast_radius: "small",
    estimated_tokens: 50,
    risk_flags: [],
    status: "objection_window",
    created: "2026-04-16T12:00:00.000Z",
    ...overrides,
  });
}

function makeReview(id: string, overrides: Partial<Review> = {}): Review {
  return createReview({
    id,
    author: "codex",
    project: PROJECT,
    target_commit: "c81fa03",
    target_plan: "pln_9c1",
    reviewer: "codex",
    verdict: "approve",
    notes: [],
    cites: [],
    created: "2026-04-16T12:00:00.000Z",
    ...overrides,
  });
}

function makeHandoff(id: string, overrides: Partial<Handoff> = {}): Handoff {
  return createHandoff({
    id,
    author: "codex",
    project: PROJECT,
    from: "codex",
    summary: "done",
    what_failed: null,
    lesson: null,
    open_questions: [],
    suggested_next: null,
    confidence_drift: 0,
    created: "2026-04-16T12:00:00.000Z",
    ...overrides,
  });
}

function makeEnv(overrides: Partial<PresenceEnv>): PresenceEnv {
  return {
    cwd: CWD,
    homeDir: "/fake/home",
    now: () => new Date("2026-04-16T12:05:00.000Z"),
    ...overrides,
  };
}

describe("humanizeAgo", () => {
  const base = new Date("2026-04-16T12:00:00.000Z");
  it("renders seconds under a minute", () => {
    expect(humanizeAgo(base, new Date("2026-04-16T11:59:30.000Z"))).toBe("30s ago");
  });
  it("renders minutes", () => {
    expect(humanizeAgo(base, new Date("2026-04-16T11:56:00.000Z"))).toBe("4m ago");
  });
});

describe("collectPresence", () => {
  let tmpHome: string;
  let store: Store;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-presence-col-"));
    store = new Store(CWD, { homeDir: tmpHome });
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpHome, { recursive: true, force: true });
  });

  async function seed(items: Artifact[]) {
    for (const a of items) {
      await store.write(a);
    }
  }

  it("returns no entries when the store is empty", async () => {
    const env = makeEnv({ homeDir: tmpHome });
    const result = await collectPresence(store, env);
    expect(result.entries).toEqual([]);
    expect(result.windowMs).toBe(15 * 60 * 1000);
    expect(result.now).toBe("2026-04-16T12:05:00.000Z");
  });

  it("groups by actor and keeps the most recent artifact per actor", async () => {
    await seed([
      makePlan("pln_c1", {
        author: "claude",
        created: "2026-04-16T12:00:00.000Z",
      }),
      makePlan("pln_c2", {
        author: "claude",
        created: "2026-04-16T12:04:30.000Z",
      }),
      makeHandoff("hnd_x", {
        from: "codex",
        created: "2026-04-16T12:01:00.000Z",
      }),
    ]);
    const env = makeEnv({ homeDir: tmpHome });
    const result = await collectPresence(store, env);

    const byAgent = new Map(result.entries.map((e) => [e.agent, e]));
    expect(byAgent.get("claude")?.lastArtifactId).toBe("pln_c2");
    expect(byAgent.get("codex")?.lastArtifactId).toBe("hnd_x");
    // Newest-first: claude's last is 12:04:30, codex's is 12:01:00
    expect(result.entries[0]?.agent).toBe("claude");
    expect(result.entries[1]?.agent).toBe("codex");
  });

  it("honours the recency window — ignores artifacts older than `windowMs`", async () => {
    await seed([
      // Inside 15min window (t-10min)
      makePlan("pln_recent", {
        author: "claude",
        created: "2026-04-16T11:55:00.000Z",
      }),
      // Outside (t-2h)
      makePlan("pln_old", {
        author: "codex",
        created: "2026-04-16T10:00:00.000Z",
      }),
    ]);
    const env = makeEnv({ homeDir: tmpHome });
    const result = await collectPresence(store, env);
    expect(result.entries.map((e) => e.agent)).toEqual(["claude"]);
  });

  it("uses `reviewer` as the actor for Review artifacts", async () => {
    await seed([
      makeReview("rev_a", {
        author: "some-author",
        reviewer: "codex",
        created: "2026-04-16T12:04:00.000Z",
      }),
    ]);
    const env = makeEnv({ homeDir: tmpHome });
    const result = await collectPresence(store, env);
    expect(result.entries[0]?.agent).toBe("codex");
  });

  it("respects a custom windowMs override", async () => {
    await seed([
      makePlan("pln_1", {
        author: "claude",
        created: "2026-04-16T12:01:00.000Z",
      }),
      makePlan("pln_2", {
        author: "codex",
        created: "2026-04-16T12:04:30.000Z",
      }),
    ]);
    const env = makeEnv({ homeDir: tmpHome });
    // Window of 90s. At t=12:05:00 the cutoff is 12:03:30; pln_1 (12:01:00)
    // is outside, pln_2 (12:04:30) is inside.
    const result = await collectPresence(store, env, { windowMs: 90 * 1000 });
    expect(result.entries.map((e) => e.agent)).toEqual(["codex"]);
  });
});

describe("formatHuman / formatJson", () => {
  it("prints 'nobody active' when no entries", () => {
    const out = formatHuman(
      { entries: [], windowMs: 1000, now: "2026-04-16T12:00:00.000Z" },
      new Date("2026-04-16T12:00:00.000Z"),
    );
    expect(out).toMatch(/nobody active/);
  });

  it("prints an [quorum] online: line followed by one line per agent", () => {
    const out = formatHuman(
      {
        entries: [
          {
            agent: "claude",
            lastActive: "2026-04-16T12:04:30.000Z",
            lastArtifactId: "pln_9c1",
            lastArtifactType: "Plan",
          },
          {
            agent: "codex",
            lastActive: "2026-04-16T12:01:00.000Z",
            lastArtifactId: "hnd_x",
            lastArtifactType: "Handoff",
          },
        ],
        windowMs: 15 * 60 * 1000,
        now: "2026-04-16T12:05:00.000Z",
      },
      new Date("2026-04-16T12:05:00.000Z"),
    );
    expect(out).toMatch(/^\[quorum\] online:/m);
    expect(out).toMatch(/claude\s+last active 30s ago/);
    expect(out).toMatch(/codex\s+last active 4m ago/);
    expect(out).toMatch(/wrote pln_9c1/);
    expect(out).toMatch(/handed off hnd_x/);
  });

  it("formatJson parses back with the documented shape", () => {
    const parsed = JSON.parse(
      formatJson({
        entries: [
          {
            agent: "claude",
            lastActive: "2026-04-16T12:04:30.000Z",
            lastArtifactId: "pln_9c1",
            lastArtifactType: "Plan",
          },
        ],
        windowMs: 15 * 60 * 1000,
        now: "2026-04-16T12:05:00.000Z",
      }),
    ) as {
      now: string;
      windowMs: number;
      online: { agent: string }[];
    };
    expect(parsed.now).toBe("2026-04-16T12:05:00.000Z");
    expect(parsed.windowMs).toBe(15 * 60 * 1000);
    expect(parsed.online).toHaveLength(1);
    expect(parsed.online[0]?.agent).toBe("claude");
  });
});

describe("runPresence", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-presence-run-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function factory(cwd: string, homeDir: string): Store {
    return new Store(cwd, { homeDir });
  }

  it("returns 0 with 'nobody active' on an empty store (cold start)", async () => {
    const logs: string[] = [];
    const env = makeEnv({ homeDir: tmpHome });
    const code = await runPresence({
      env,
      log: (m) => logs.push(m),
      storeFactory: factory,
    });
    expect(code).toBe(0);
    expect(logs[0]).toMatch(/nobody active/);
  });

  it("prints the expected text report with populated data", async () => {
    const seedStore = new Store(CWD, { homeDir: tmpHome });
    await seedStore.write(
      makePlan("pln_live", {
        author: "claude",
        created: "2026-04-16T12:04:30.000Z",
      }),
    );
    await seedStore.close();

    const logs: string[] = [];
    const env = makeEnv({ homeDir: tmpHome });
    const code = await runPresence({
      env,
      log: (m) => logs.push(m),
      storeFactory: factory,
    });
    expect(code).toBe(0);
    expect(logs[0]).toMatch(/\[quorum\] online:/);
    expect(logs[0]).toMatch(/claude/);
    expect(logs[0]).toMatch(/pln_live/);
  });

  it("--json emits a parseable payload", async () => {
    const seedStore = new Store(CWD, { homeDir: tmpHome });
    await seedStore.write(
      makePlan("pln_j", {
        author: "claude",
        created: "2026-04-16T12:04:30.000Z",
      }),
    );
    await seedStore.close();

    const logs: string[] = [];
    const env = makeEnv({ homeDir: tmpHome });
    const code = await runPresence({
      env,
      log: (m) => logs.push(m),
      storeFactory: factory,
      flags: { json: true },
    });
    expect(code).toBe(0);
    const payload = JSON.parse(logs[0]) as {
      online: { agent: string; lastArtifactId: string }[];
    };
    expect(payload.online[0]?.agent).toBe("claude");
    expect(payload.online[0]?.lastArtifactId).toBe("pln_j");
  });

  it("returns 1 if store construction fails", async () => {
    const errs: string[] = [];
    const env = makeEnv({ homeDir: tmpHome });
    const code = await runPresence({
      env,
      log: () => {},
      err: (m) => errs.push(m),
      storeFactory: () => {
        throw new Error("boom");
      },
    });
    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/failed to open store/);
  });
});
