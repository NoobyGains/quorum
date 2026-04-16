import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlan, createClaim, createDecision } from "@quorum/artifacts";

import { SqliteIndex } from "./sqlite-index.js";

function fakeSha() {
  return "0".repeat(40);
}

describe("SqliteIndex", () => {
  let tmp: string;
  let index: SqliteIndex;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "quorum-store-idx-"));
    index = new SqliteIndex(join(tmp, "index.db"));
  });

  afterEach(() => {
    index.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("indexes and retrieves by id", () => {
    const plan = createPlan({
      id: "pln_g1",
      author: "claude",
      project: "p",
      goal: "g",
      approach: "a",
      files_touched: [],
      assumptions: [],
      confidence: 0.8,
      blast_radius: "small",
      estimated_tokens: 0,
      risk_flags: [],
      status: "approved",
    });
    index.index(plan, fakeSha());
    const got = index.get("pln_g1");
    expect(got?.id).toBe("pln_g1");
    expect(got?.type).toBe("Plan");
  });

  it("query filters by type, author, and createdAfter", () => {
    const base = {
      project: "p",
      goal: "g",
      approach: "a",
      files_touched: [],
      assumptions: [],
      confidence: 0.5,
      blast_radius: "small" as const,
      estimated_tokens: 0,
      risk_flags: [],
      status: "approved" as const,
    };
    const p1 = createPlan({
      ...base,
      id: "pln_q1",
      author: "claude",
      created: "2026-04-10T00:00:00.000Z",
    });
    const p2 = createPlan({
      ...base,
      id: "pln_q2",
      author: "codex",
      created: "2026-04-15T00:00:00.000Z",
    });
    const c1 = createClaim({
      id: "clm_q1",
      author: "claude",
      project: "p",
      target: "gh-issue-1",
      agent: "claude",
      exclusive: true,
      ttl_seconds: 600,
      reason: "x",
      created: "2026-04-12T00:00:00.000Z",
    });
    index.index(p1, fakeSha());
    index.index(p2, fakeSha());
    index.index(c1, fakeSha());

    expect(index.query({ type: "Plan" }).map((a) => a.id).sort()).toEqual([
      "pln_q1",
      "pln_q2",
    ]);
    expect(index.query({ author: "claude" }).map((a) => a.id).sort()).toEqual([
      "clm_q1",
      "pln_q1",
    ]);
    expect(
      index
        .query({ createdAfter: "2026-04-11T00:00:00.000Z" })
        .map((a) => a.id)
        .sort(),
    ).toEqual(["clm_q1", "pln_q2"]);

    // Combined filter + limit + descending order by created
    const limited = index.query({ type: "Plan", limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]?.id).toBe("pln_q2");
  });

  it("FTS5 search matches against serialized body", () => {
    const plan = createPlan({
      id: "pln_fts1",
      author: "claude",
      project: "p",
      goal: "rate-limit the users endpoint",
      approach: "sliding window",
      files_touched: [],
      assumptions: [],
      confidence: 0.9,
      blast_radius: "small",
      estimated_tokens: 0,
      risk_flags: [],
      status: "approved",
    });
    const decision = createDecision({
      id: "dcs_fts1",
      author: "codex",
      project: "p",
      question: "needs a throttle?",
      options: ["A", "B"],
      chosen: "A",
      rationale: "simplest viable approach",
      signed_by: ["claude", "codex"],
      expires: null,
    });
    index.index(plan, fakeSha());
    index.index(decision, fakeSha());

    const rateMatches = index.search("rate");
    expect(rateMatches.map((a) => a.id)).toEqual(["pln_fts1"]);

    const throttleMatches = index.search("throttle");
    expect(throttleMatches.map((a) => a.id)).toEqual(["dcs_fts1"]);
  });

  it("latestOfType returns newest first, limit respected", () => {
    const base = {
      project: "p",
      goal: "g",
      approach: "a",
      files_touched: [],
      assumptions: [],
      confidence: 0.5,
      blast_radius: "small" as const,
      estimated_tokens: 0,
      risk_flags: [],
      status: "approved" as const,
    };
    index.index(
      createPlan({
        ...base,
        id: "pln_l1",
        author: "claude",
        created: "2026-04-01T00:00:00.000Z",
      }),
      fakeSha(),
    );
    index.index(
      createPlan({
        ...base,
        id: "pln_l2",
        author: "claude",
        created: "2026-04-10T00:00:00.000Z",
      }),
      fakeSha(),
    );
    index.index(
      createPlan({
        ...base,
        id: "pln_l3",
        author: "claude",
        created: "2026-04-05T00:00:00.000Z",
      }),
      fakeSha(),
    );

    const all = index.latestOfType("Plan");
    expect(all.map((a) => a.id)).toEqual(["pln_l2", "pln_l3", "pln_l1"]);

    const two = index.latestOfType("Plan", 2);
    expect(two.map((a) => a.id)).toEqual(["pln_l2", "pln_l3"]);
  });

  it("supersededBy finds the successor", () => {
    const base = {
      project: "p",
      goal: "g",
      approach: "a",
      files_touched: [],
      assumptions: [],
      confidence: 0.5,
      blast_radius: "small" as const,
      estimated_tokens: 0,
      risk_flags: [],
      status: "approved" as const,
    };
    index.index(
      createPlan({ ...base, id: "pln_old", author: "claude" }),
      fakeSha(),
    );
    index.index(
      createPlan({
        ...base,
        id: "pln_new",
        author: "claude",
        supersedes: "pln_old",
        version: 2,
      }),
      fakeSha(),
    );

    const next = index.supersededBy("pln_old");
    expect(next?.id).toBe("pln_new");
    expect(index.supersededBy("pln_unrelated")).toBeNull();
  });

  it("index is idempotent — re-indexing same id updates in place", () => {
    const plan = createPlan({
      id: "pln_idem",
      author: "claude",
      project: "p",
      goal: "original",
      approach: "a",
      files_touched: [],
      assumptions: [],
      confidence: 0.5,
      blast_radius: "small",
      estimated_tokens: 0,
      risk_flags: [],
      status: "approved",
    });
    index.index(plan, fakeSha());
    index.index(plan, fakeSha());
    const rows = index.query({ type: "Plan" });
    expect(rows).toHaveLength(1);
  });
});
