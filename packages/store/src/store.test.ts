import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlan, type Artifact, type Plan } from "@quorum/artifacts";

import { Store } from "./store.js";

function makePlan(id = "pln_s1", overrides: Partial<Plan> = {}) {
  return createPlan({
    id,
    author: "claude",
    project: "quorum-test",
    goal: "test goal",
    approach: "test approach",
    files_touched: [],
    assumptions: [],
    confidence: 0.9,
    blast_radius: "small",
    estimated_tokens: 100,
    risk_flags: [],
    status: "objection_window",
    ...overrides,
  });
}

describe("Store", () => {
  let tmpHome: string;
  const cwd = "/fake/project/store-test";
  let store: Store;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-store-combo-"));
    store = new Store(cwd, { homeDir: tmpHome, warn: () => {} });
  });

  afterEach(async () => {
    await store.close();
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("write -> read round-trips through sqlite", async () => {
    const plan = makePlan("pln_rt1");
    await store.write(plan);
    const got = await store.read("pln_rt1");
    expect(got?.id).toBe("pln_rt1");
    expect(got?.type).toBe("Plan");
  });

  it("write rejects an invalid artifact (missing required field)", async () => {
    // Cast through `unknown` to an `Artifact`: the Zod schema rejects it at
    // runtime, which is exactly what we're asserting. A direct cast would
    // trip @typescript-eslint/no-unsafe-argument.
    const bad = {
      id: "pln_bad",
      type: "Plan",
      author: "claude",
      created: new Date().toISOString(),
      project: "p",
      version: 1,
      supersedes: null,
      signatures: [],
      // missing goal, approach, etc.
    } as unknown as Artifact;
    await expect(store.write(bad)).rejects.toThrow(/invalid artifact/);
  });

  it("list and search query the sqlite index", async () => {
    await store.write(
      makePlan("pln_q1", { goal: "throttle user endpoint" }),
    );
    await store.write(
      makePlan("pln_q2", { goal: "migrate db schema", author: "codex" }),
    );

    const all = await store.list();
    expect(all.map((a) => a.id).sort()).toEqual(["pln_q1", "pln_q2"]);

    const byAuthor = await store.list({ author: "codex" });
    expect(byAuthor.map((a) => a.id)).toEqual(["pln_q2"]);

    const hits = await store.search("throttle");
    expect(hits.map((a) => a.id)).toEqual(["pln_q1"]);
  });

  it("git-sqlite consistency: after write, both stores see the same artifact", async () => {
    const plan = makePlan("pln_cons");
    await store.write(plan);

    // Read via Store (tries sqlite first, falls through to git)
    const viaStore = await store.read("pln_cons");
    expect(viaStore?.id).toBe("pln_cons");

    // Reopen store — mimics a fresh process. Both layers must already know it.
    await store.close();
    store = new Store(cwd, { homeDir: tmpHome, warn: () => {} });
    const reopened = await store.read("pln_cons");
    expect(reopened?.id).toBe("pln_cons");
  });

  it("supersede chains through the Store API", async () => {
    const v1 = makePlan("pln_sup1");
    await store.write(v1);

    const v2 = makePlan("pln_sup2", {
      supersedes: "pln_sup1",
      version: 2,
    });
    await store.supersede("pln_sup1", v2);

    const next = await store.supersededBy("pln_sup1");
    expect(next?.id).toBe("pln_sup2");
  });

  it("latestOfType returns the newest", async () => {
    await store.write(
      makePlan("pln_lt1", { created: "2026-04-01T00:00:00.000Z" }),
    );
    await store.write(
      makePlan("pln_lt2", { created: "2026-04-05T00:00:00.000Z" }),
    );
    const [first] = await store.latestOfType("Plan", 1);
    expect(first?.id).toBe("pln_lt2");
  });
});
