import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    store = new Store(cwd, { homeDir: tmpHome });
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
    store = new Store(cwd, { homeDir: tmpHome });
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

  // Regression #52: prior behavior was to warn-and-continue when the sqlite
  // index write failed, leaving the artifact in git but invisible to
  // list/search/latestOfType/supersededBy (which only read sqlite). Now the
  // write must throw so the caller sees the failure.
  it("write throws when the sqlite index fails", async () => {
    // @ts-expect-error - reaching into a private field is fine in tests
    vi.spyOn(store.sqlite, "index").mockImplementation(() => {
      throw new Error("disk full");
    });
    await expect(store.write(makePlan("pln_idxfail"))).rejects.toThrow(
      /disk full|sqlite index/i,
    );
  });

  it("supersede throws when the sqlite index fails", async () => {
    await store.write(makePlan("pln_suporig"));
    // @ts-expect-error - reaching into a private field is fine in tests
    vi.spyOn(store.sqlite, "index").mockImplementation(() => {
      throw new Error("disk full");
    });
    const next = makePlan("pln_supnext", {
      supersedes: "pln_suporig",
      version: 2,
    });
    await expect(store.supersede("pln_suporig", next)).rejects.toThrow(
      /disk full|sqlite index/i,
    );
  });

  it("retrying a write after a transient index failure heals the index", async () => {
    const plan = makePlan("pln_retry");
    // @ts-expect-error - reaching into a private field is fine in tests
    const spy = vi.spyOn(store.sqlite, "index");
    spy.mockImplementationOnce(() => {
      throw new Error("transient");
    });
    await expect(store.write(plan)).rejects.toThrow(/transient|sqlite index/i);

    // Second attempt: spy falls through to the real impl. Git is idempotent
    // (same id → same ref), so the retry should succeed and the artifact
    // should show up in list/search.
    spy.mockRestore();
    await store.write(plan);

    const all = await store.list();
    expect(all.map((a) => a.id)).toContain("pln_retry");
  });

  it("rebuildIndex repopulates sqlite from git after index wipe", async () => {
    await store.write(makePlan("pln_rb1", { goal: "rebuild me" }));
    await store.write(makePlan("pln_rb2", { author: "codex" }));

    // Simulate a catastrophic index loss: wipe the artifacts table.
    // @ts-expect-error - reaching into a private field is fine in tests
    (store.sqlite as unknown as { db: { exec: (s: string) => void } }).db.exec(
      "DELETE FROM artifacts",
    );
    const afterWipe = await store.list();
    expect(afterWipe).toHaveLength(0);

    await store.rebuildIndex();

    const all = await store.list();
    expect(all.map((a) => a.id).sort()).toEqual(["pln_rb1", "pln_rb2"]);
    const hits = await store.search("rebuild");
    expect(hits.map((a) => a.id)).toEqual(["pln_rb1"]);
  });
});
