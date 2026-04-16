import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createDisagreement,
  createHandoff,
  createPlan,
  createQuestion,
  createReview,
  type Artifact,
  type Disagreement,
  type Handoff,
  type Plan,
  type Question,
  type Review,
} from "@quorum/artifacts";
import { Store, storageRoot } from "@quorum/store";

import {
  collectInbox,
  formatHuman,
  formatJson,
  humanizeAgo,
  isAddressedToMe,
  lastSeenPath,
  readLastSeen,
  runInbox,
  summarize,
  writeLastSeen,
  type InboxEnv,
} from "./inbox.js";

const PROJECT = "quorum-inbox-test";
const CWD = "/fake/project/inbox-test";

function makePlan(
  id: string,
  overrides: Partial<Plan> = {},
): Plan {
  return createPlan({
    id,
    author: "codex",
    project: PROJECT,
    goal: "test goal",
    approach: "test approach",
    files_touched: [],
    assumptions: [],
    confidence: 0.9,
    blast_radius: "small",
    estimated_tokens: 100,
    risk_flags: [],
    status: "objection_window",
    created: "2026-04-16T12:00:00.000Z",
    ...overrides,
  });
}

function makeQuestion(
  id: string,
  overrides: Partial<Question> = {},
): Question {
  return createQuestion({
    id,
    author: "codex",
    project: PROJECT,
    text: "do you prefer A or B?",
    blocking: true,
    addressed_to: ["claude"],
    context: [],
    created: "2026-04-16T12:00:00.000Z",
    ...overrides,
  });
}

function makeReview(
  id: string,
  overrides: Partial<Review> = {},
): Review {
  return createReview({
    id,
    author: "codex",
    project: PROJECT,
    target_commit: "c81fa03",
    target_plan: "pln_9c1",
    reviewer: "codex",
    verdict: "request_changes",
    notes: [],
    cites: [],
    created: "2026-04-16T12:00:00.000Z",
    ...overrides,
  });
}

function makeDisagreement(
  id: string,
  overrides: Partial<Disagreement> = {},
): Disagreement {
  return createDisagreement({
    id,
    author: "codex",
    project: PROJECT,
    target: "pln_9c1",
    thesis_agent: "claude",
    thesis: "A",
    antithesis_agent: "codex",
    antithesis: "B",
    evidence: [],
    severity: "blocks_merge",
    rounds: [],
    status: "open",
    created: "2026-04-16T12:00:00.000Z",
    ...overrides,
  });
}

function makeHandoff(
  id: string,
  overrides: Partial<Handoff> = {},
): Handoff {
  return createHandoff({
    id,
    author: "codex",
    project: PROJECT,
    from: "codex",
    summary: "implemented X",
    what_failed: null,
    lesson: null,
    open_questions: [],
    suggested_next: null,
    confidence_drift: 0,
    created: "2026-04-16T12:00:00.000Z",
    ...overrides,
  });
}

function makeEnv(overrides: Partial<InboxEnv>): InboxEnv {
  return {
    cwd: CWD,
    homeDir: "/fake/home",
    now: () => new Date("2026-04-16T12:05:00.000Z"),
    getEnv: () => undefined,
    ...overrides,
  };
}

describe("isAddressedToMe", () => {
  it("Question: true when I'm in addressed_to", () => {
    const q = makeQuestion("qst_1", { addressed_to: ["claude", "ops"] });
    expect(isAddressedToMe(q, "claude")).toBe(true);
    expect(isAddressedToMe(q, "codex")).toBe(false);
  });

  it("Review: true when I'm NOT the reviewer (incoming review)", () => {
    const r = makeReview("rev_1", { reviewer: "codex" });
    expect(isAddressedToMe(r, "claude")).toBe(true);
    expect(isAddressedToMe(r, "codex")).toBe(false);
  });

  it("Disagreement: true when I'm thesis_agent or antithesis_agent", () => {
    const d = makeDisagreement("dsg_1", {
      thesis_agent: "claude",
      antithesis_agent: "codex",
    });
    expect(isAddressedToMe(d, "claude")).toBe(true);
    expect(isAddressedToMe(d, "codex")).toBe(true);
    expect(isAddressedToMe(d, "ops")).toBe(false);
  });

  it("Handoff: true when I'm not the sender", () => {
    const h = makeHandoff("hnd_1", { from: "codex" });
    expect(isAddressedToMe(h, "claude")).toBe(true);
    expect(isAddressedToMe(h, "codex")).toBe(false);
  });

  it("Plan/default: true when author is someone else", () => {
    const p = makePlan("pln_1", { author: "codex" });
    expect(isAddressedToMe(p, "claude")).toBe(true);
    expect(isAddressedToMe(p, "codex")).toBe(false);
  });
});

describe("summarize", () => {
  it("renders a type-specific fragment", () => {
    expect(summarize(makePlan("pln_s", { goal: "hello" }))).toContain("hello");
    expect(
      summarize(
        makeReview("rev_s", { verdict: "approve", target_commit: "abcdef1234" }),
      ),
    ).toBe("approve on abcdef1");
  });
});

describe("humanizeAgo", () => {
  const base = new Date("2026-04-16T12:00:00.000Z");
  it("seconds under a minute", () => {
    expect(humanizeAgo(base, new Date("2026-04-16T11:59:30.000Z"))).toBe("30s ago");
  });
  it("minutes under an hour", () => {
    expect(humanizeAgo(base, new Date("2026-04-16T11:58:00.000Z"))).toBe("2m ago");
  });
  it("hours under a day", () => {
    expect(humanizeAgo(base, new Date("2026-04-16T09:00:00.000Z"))).toBe("3h ago");
  });
  it("days after that", () => {
    expect(humanizeAgo(base, new Date("2026-04-14T12:00:00.000Z"))).toBe("2d ago");
  });
  it("clamps future timestamps to 0s", () => {
    expect(humanizeAgo(base, new Date("2030-01-01T00:00:00.000Z"))).toBe("0s ago");
  });
});

describe("readLastSeen / writeLastSeen (filesystem round-trip)", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-inbox-ls-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns null when no marker file exists (cold start)", () => {
    expect(readLastSeen(tmpHome, CWD, "claude")).toBeNull();
  });

  it("round-trips an ISO timestamp", () => {
    const iso = "2026-04-16T12:00:00.000Z";
    writeLastSeen(tmpHome, CWD, "claude", iso);
    expect(readLastSeen(tmpHome, CWD, "claude")).toBe(iso);
  });

  it("writes under <storageRoot>/inbox/<agent>.last_seen", () => {
    writeLastSeen(tmpHome, CWD, "claude", "2026-04-16T12:00:00.000Z");
    const expected = lastSeenPath(tmpHome, CWD, "claude");
    expect(expected).toBe(
      join(storageRoot(CWD, tmpHome), "inbox", "claude.last_seen"),
    );
    expect(existsSync(expected)).toBe(true);
  });

  it("keeps separate markers per agent", () => {
    writeLastSeen(tmpHome, CWD, "claude", "2026-04-16T12:00:00.000Z");
    writeLastSeen(tmpHome, CWD, "codex", "2026-04-16T11:00:00.000Z");
    expect(readLastSeen(tmpHome, CWD, "claude")).toBe(
      "2026-04-16T12:00:00.000Z",
    );
    expect(readLastSeen(tmpHome, CWD, "codex")).toBe(
      "2026-04-16T11:00:00.000Z",
    );
  });
});

describe("collectInbox", () => {
  let tmpHome: string;
  let store: Store;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-inbox-col-"));
    store = new Store(CWD, { homeDir: tmpHome, warn: () => {} });
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

  it("returns nothing when the store is empty", async () => {
    const env = makeEnv({ homeDir: tmpHome });
    const result = await collectInbox(store, env, { agent: "claude" });
    expect(result.items).toEqual([]);
    expect(result.agent).toBe("claude");
  });

  it("filters by 'addressed to me' semantics across types", async () => {
    await seed([
      // Should be included — codex's plan, claude is reading
      makePlan("pln_a", {
        author: "codex",
        created: "2026-04-16T12:00:00.000Z",
      }),
      // Excluded — claude's own plan
      makePlan("pln_b", {
        author: "claude",
        created: "2026-04-16T12:00:01.000Z",
      }),
      // Included — question addressed to claude
      makeQuestion("qst_a", {
        author: "codex",
        addressed_to: ["claude"],
        created: "2026-04-16T12:00:02.000Z",
      }),
      // Excluded — question to ops only
      makeQuestion("qst_b", {
        author: "codex",
        addressed_to: ["ops"],
        created: "2026-04-16T12:00:03.000Z",
      }),
      // Included — incoming review
      makeReview("rev_a", {
        reviewer: "codex",
        created: "2026-04-16T12:00:04.000Z",
      }),
      // Excluded — claude's own review
      makeReview("rev_b", {
        author: "claude",
        reviewer: "claude",
        created: "2026-04-16T12:00:05.000Z",
      }),
      // Included — handoff from codex
      makeHandoff("hnd_a", {
        from: "codex",
        created: "2026-04-16T12:00:06.000Z",
      }),
    ]);

    const env = makeEnv({ homeDir: tmpHome });
    const result = await collectInbox(store, env, { agent: "claude" });
    const ids = result.items.map((i) => i.id).sort();
    expect(ids).toEqual(["hnd_a", "pln_a", "qst_a", "rev_a"]);
  });

  it("sorts newest-first", async () => {
    await seed([
      makePlan("pln_old", {
        author: "codex",
        created: "2026-04-16T10:00:00.000Z",
      }),
      makePlan("pln_new", {
        author: "codex",
        created: "2026-04-16T12:00:00.000Z",
      }),
      makePlan("pln_mid", {
        author: "codex",
        created: "2026-04-16T11:00:00.000Z",
      }),
    ]);
    const env = makeEnv({ homeDir: tmpHome });
    const result = await collectInbox(store, env, { agent: "claude" });
    expect(result.items.map((i) => i.id)).toEqual([
      "pln_new",
      "pln_mid",
      "pln_old",
    ]);
  });

  it("honours --since as a strict lower bound", async () => {
    await seed([
      makePlan("pln_1", {
        author: "codex",
        created: "2026-04-16T10:00:00.000Z",
      }),
      makePlan("pln_2", {
        author: "codex",
        created: "2026-04-16T12:00:00.000Z",
      }),
    ]);
    const env = makeEnv({ homeDir: tmpHome });
    const result = await collectInbox(store, env, {
      agent: "claude",
      since: "2026-04-16T11:00:00.000Z",
    });
    expect(result.items.map((i) => i.id)).toEqual(["pln_2"]);
    expect(result.since).toBe("2026-04-16T11:00:00.000Z");
  });

  it("with --unread uses the stored watermark", async () => {
    writeLastSeen(tmpHome, CWD, "claude", "2026-04-16T11:30:00.000Z");
    await seed([
      makePlan("pln_old", {
        author: "codex",
        created: "2026-04-16T10:00:00.000Z",
      }),
      makePlan("pln_new", {
        author: "codex",
        created: "2026-04-16T12:00:00.000Z",
      }),
    ]);
    const env = makeEnv({ homeDir: tmpHome });
    const result = await collectInbox(store, env, {
      agent: "claude",
      unread: true,
    });
    expect(result.items.map((i) => i.id)).toEqual(["pln_new"]);
    expect(result.since).toBe("2026-04-16T11:30:00.000Z");
  });

  it("resolves agent via QUORUM_AGENT env var, falling back to 'claude'", async () => {
    const env1 = makeEnv({
      homeDir: tmpHome,
      getEnv: (k) => (k === "QUORUM_AGENT" ? "codex" : undefined),
    });
    const r1 = await collectInbox(store, env1, {});
    expect(r1.agent).toBe("codex");

    const env2 = makeEnv({ homeDir: tmpHome });
    const r2 = await collectInbox(store, env2, {});
    expect(r2.agent).toBe("claude");
  });
});

describe("runInbox", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-inbox-run-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function factory(cwd: string, homeDir: string): Store {
    return new Store(cwd, { homeDir, warn: () => {} });
  }

  it("returns 0 and prints zero-count message when the inbox is empty", async () => {
    const logs: string[] = [];
    const errs: string[] = [];
    const env = makeEnv({ homeDir: tmpHome });
    const code = await runInbox({
      env,
      log: (m) => logs.push(m),
      err: (m) => errs.push(m),
      storeFactory: factory,
      flags: { agent: "claude" },
    });
    expect(code).toBe(0);
    expect(errs).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("0 unread for claude");
  });

  it("advances the last_seen marker when --unread is set", async () => {
    const env = makeEnv({ homeDir: tmpHome });

    // seed one plan
    const seedStore = new Store(CWD, { homeDir: tmpHome, warn: () => {} });
    await seedStore.write(
      makePlan("pln_1", {
        author: "codex",
        created: "2026-04-16T12:00:00.000Z",
      }),
    );
    await seedStore.close();

    const pinned = "2026-04-16T12:05:00.000Z";
    const run1 = await runInbox({
      env: { ...env, now: () => new Date(pinned) },
      log: () => {},
      storeFactory: factory,
      flags: { agent: "claude", unread: true },
    });
    expect(run1).toBe(0);

    const lsPath = lastSeenPath(tmpHome, CWD, "claude");
    expect(existsSync(lsPath)).toBe(true);
    expect(readFileSync(lsPath, "utf8").trim()).toBe(pinned);

    // Second invocation: nothing newer than the watermark, should print 0.
    const logs: string[] = [];
    const run2 = await runInbox({
      env: { ...env, now: () => new Date(pinned) },
      log: (m) => logs.push(m),
      storeFactory: factory,
      flags: { agent: "claude", unread: true },
    });
    expect(run2).toBe(0);
    expect(logs[0]).toContain("0 unread for claude");
  });

  it("does NOT advance last_seen when --unread is not passed", async () => {
    const env = makeEnv({ homeDir: tmpHome });
    const seedStore = new Store(CWD, { homeDir: tmpHome, warn: () => {} });
    await seedStore.write(
      makePlan("pln_1", {
        author: "codex",
        created: "2026-04-16T12:00:00.000Z",
      }),
    );
    await seedStore.close();

    const code = await runInbox({
      env,
      log: () => {},
      storeFactory: factory,
      flags: { agent: "claude" },
    });
    expect(code).toBe(0);
    expect(existsSync(lastSeenPath(tmpHome, CWD, "claude"))).toBe(false);
  });

  it("--json emits a parseable payload", async () => {
    const seedStore = new Store(CWD, { homeDir: tmpHome, warn: () => {} });
    await seedStore.write(
      makePlan("pln_j", {
        author: "codex",
        created: "2026-04-16T12:00:00.000Z",
      }),
    );
    await seedStore.close();

    const logs: string[] = [];
    const env = makeEnv({ homeDir: tmpHome });
    const code = await runInbox({
      env,
      log: (m) => logs.push(m),
      storeFactory: factory,
      flags: { agent: "claude", json: true },
    });
    expect(code).toBe(0);
    expect(logs).toHaveLength(1);
    const payload = JSON.parse(logs[0]) as {
      agent: string;
      count: number;
      items: { id: string }[];
    };
    expect(payload.agent).toBe("claude");
    expect(payload.count).toBe(1);
    expect(payload.items[0]?.id).toBe("pln_j");
  });

  it("handles cold start with no ~/.quorum subdir gracefully", async () => {
    // The Store constructor creates the storage root on demand — this test
    // makes sure we don't crash on a tmp home that has no .quorum yet.
    const env = makeEnv({ homeDir: tmpHome });
    const logs: string[] = [];
    const code = await runInbox({
      env,
      log: (m) => logs.push(m),
      storeFactory: factory,
      flags: { agent: "claude", unread: true },
    });
    expect(code).toBe(0);
    expect(logs[0]).toContain("0 unread");
  });

  it("returns 1 if the store factory throws", async () => {
    const errs: string[] = [];
    const env = makeEnv({ homeDir: tmpHome });
    const code = await runInbox({
      env,
      log: () => {},
      err: (m) => errs.push(m),
      storeFactory: () => {
        throw new Error("boom");
      },
      flags: { agent: "claude" },
    });
    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/failed to open store/);
  });
});

describe("formatHuman / formatJson", () => {
  it("formatHuman prints the expected header and one line per item", () => {
    const out = formatHuman(
      {
        agent: "claude",
        since: "2026-04-16T14:00:00.000Z",
        items: [
          {
            id: "pln_9c1",
            type: "Plan",
            from: "codex",
            created: "2026-04-16T14:03:00.000Z",
            summary: "\"Rate-limit\"",
          },
        ],
      },
      { now: new Date("2026-04-16T14:05:00.000Z") },
    );
    expect(out).toMatch(/^\[quorum\] 1 unread for claude since 2026-04-16T14:00:00\.000Z:$/m);
    expect(out).toMatch(/pln_9c1/);
    expect(out).toMatch(/from codex/);
    expect(out).toMatch(/2m ago/);
  });

  it("formatJson is valid JSON with the documented shape", () => {
    const parsed = JSON.parse(
      formatJson({
        agent: "claude",
        since: null,
        items: [],
      }),
    ) as { agent: string; since: string | null; count: number; items: unknown[] };
    expect(parsed.agent).toBe("claude");
    expect(parsed.since).toBeNull();
    expect(parsed.count).toBe(0);
    expect(parsed.items).toEqual([]);
  });
});
