import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDisagreement, createPlan } from "@quorum/artifacts";
import { Store } from "@quorum/store";
import { describe, expect, it } from "vitest";

import {
  computePlanStatus,
  evaluateIntent,
  refreshPlanStatus,
  type IntentConfig,
} from "./intent.js";

const NOW = 1_000_000_000;

const FIXED_CONFIG: IntentConfig = {
  objectionWindowMs: 10_000,
  now: () => NOW,
};

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function makePlan(
  id = "pln_base",
  overrides: Partial<Parameters<typeof createPlan>[0]> = {},
) {
  return createPlan({
    id,
    author: "claude",
    project: "quorum-test",
    created: iso(NOW - 5_000),
    goal: "test goal",
    approach: "test approach",
    files_touched: ["src/a.ts"],
    assumptions: [],
    confidence: 0.9,
    blast_radius: "small",
    estimated_tokens: 100,
    risk_flags: [],
    status: "objection_window",
    ...overrides,
  });
}

function makeDisagreement(
  target: string,
  overrides: Partial<Parameters<typeof createDisagreement>[0]> = {},
) {
  return createDisagreement({
    id: "dsg_base",
    author: "codex",
    project: "quorum-test",
    created: iso(NOW - 1_000),
    target,
    thesis_agent: "claude",
    thesis: "Use Redis",
    antithesis_agent: "codex",
    antithesis: "Use DynamoDB",
    evidence: [],
    severity: "blocks_merge",
    rounds: [],
    status: "open",
    ...overrides,
  });
}

describe("intent protocol", () => {
  it("returns objection_window for a fresh plan before closesAt with no disagreements", () => {
    const plan = makePlan("pln_fresh");
    const evaluation = evaluateIntent(plan, [], FIXED_CONFIG);

    expect(evaluation.status).toBe("objection_window");
    expect(evaluation.closesAt).toBe(NOW + 5_000);
    expect(evaluation.blockingDisagreements).toEqual([]);
  });

  it("returns approved after the objection window closes with no disagreements", () => {
    const plan = makePlan("pln_approved", {
      created: iso(NOW - 20_000),
    });

    expect(computePlanStatus(plan, [], FIXED_CONFIG)).toBe("approved");
  });

  it("returns blocked when there is an open blocks_merge disagreement targeting the plan", () => {
    const plan = makePlan("pln_blocked", {
      created: iso(NOW - 20_000),
    });
    const disagreement = makeDisagreement(plan.id);

    const evaluation = evaluateIntent(plan, [disagreement], FIXED_CONFIG);

    expect(evaluation.status).toBe("blocked");
    expect(evaluation.blockingDisagreements.map((item) => item.id)).toEqual([
      disagreement.id,
    ]);
  });

  it("returns approved when blocking disagreements are resolved and the window has closed", () => {
    const plan = makePlan("pln_resolved", {
      created: iso(NOW - 20_000),
    });
    const resolved = makeDisagreement(plan.id, {
      id: "dsg_resolved",
      status: "resolved",
    });
    const advisory = makeDisagreement(plan.id, {
      id: "dsg_advisory",
      severity: "advisory",
    });

    const evaluation = evaluateIntent(plan, [resolved, advisory], FIXED_CONFIG);

    expect(evaluation.status).toBe("approved");
    expect(evaluation.blockingDisagreements).toEqual([]);
  });

  it("returns superseded when the plan itself is superseded", () => {
    const plan = makePlan("pln_superseded", {
      status: "superseded",
    });
    const disagreement = makeDisagreement(plan.id);

    expect(computePlanStatus(plan, [disagreement], FIXED_CONFIG)).toBe(
      "superseded",
    );
  });

  it("approves immediately when objectionWindowMs is zero", () => {
    const plan = makePlan("pln_immediate", {
      created: iso(NOW),
    });

    expect(
      computePlanStatus(plan, [], {
        objectionWindowMs: 0,
        now: () => NOW,
      }),
    ).toBe("approved");
  });

  it("refreshPlanStatus reads from the real Store and returns the computed status", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "quorum-protocols-intent-"));
    const store = new Store("/fake/project/protocols-intent", {
      homeDir: tempHome,
    });

    try {
      const plan = makePlan("pln_store", {
        created: iso(NOW - 20_000),
      });
      const disagreement = makeDisagreement(plan.id, {
        id: "dsg_store",
      });

      await store.write(plan);
      await store.write(disagreement);

      const evaluation = await refreshPlanStatus(store, plan.id, FIXED_CONFIG);

      expect(evaluation.status).toBe("blocked");
      expect(evaluation.blockingDisagreements.map((item) => item.id)).toEqual([
        disagreement.id,
      ]);
    } finally {
      await store.close();
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
