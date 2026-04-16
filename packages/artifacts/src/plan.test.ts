import { describe, it, expect } from "vitest";

import { PlanSchema, createPlan, isPlan } from "./plan.js";

const valid = {
  id: "pln_9c1",
  type: "Plan" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  goal: "Rate-limit /api/users to 100 req/min per IP",
  approach: "In-memory LRU sliding window",
  files_touched: ["src/middleware/rateLimit.ts", "src/routes/users.ts"],
  assumptions: ["<=2 nodes, session affinity active"],
  confidence: 0.91,
  blast_radius: "small" as const,
  estimated_tokens: 12000,
  risk_flags: [{ severity: "low" as const, mitigation: "monitor in grafana" }],
  status: "objection_window" as const,
};

describe("PlanSchema", () => {
  it("accepts the docs/artifacts.md § 1 example", () => {
    expect(PlanSchema.parse(valid)).toEqual(valid);
    expect(isPlan(valid)).toBe(true);
  });

  it("rejects a missing required field (goal)", () => {
    const { goal: _g, ...rest } = valid;
    void _g;
    expect(PlanSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(PlanSchema.safeParse({ ...valid, type: "Claim" }).success).toBe(false);
  });

  it("rejects an invalid blast_radius enum", () => {
    expect(
      PlanSchema.safeParse({ ...valid, blast_radius: "gigantic" }).success,
    ).toBe(false);
  });

  it("rejects an invalid status enum", () => {
    expect(PlanSchema.safeParse({ ...valid, status: "maybe" }).success).toBe(
      false,
    );
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(PlanSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(
      false,
    );
    expect(PlanSchema.safeParse({ ...valid, confidence: -0.1 }).success).toBe(
      false,
    );
  });

  it("rejects a malformed id", () => {
    expect(PlanSchema.safeParse({ ...valid, id: "PLN-9c1" }).success).toBe(
      false,
    );
  });

  it("isPlan returns false for unrelated shapes", () => {
    expect(isPlan({})).toBe(false);
    expect(isPlan({ type: "Plan" })).toBe(false);
    expect(isPlan(null)).toBe(false);
  });

  it("createPlan fills in common defaults", () => {
    const plan = createPlan({
      id: "pln_abc",
      author: "claude",
      project: "user-api",
      goal: valid.goal,
      approach: valid.approach,
      files_touched: valid.files_touched,
      assumptions: valid.assumptions,
      confidence: 0.5,
      blast_radius: "small",
      estimated_tokens: 100,
      risk_flags: [],
      status: "objection_window",
    });
    expect(plan.type).toBe("Plan");
    expect(plan.version).toBe(1);
    expect(plan.supersedes).toBeNull();
    expect(plan.signatures).toEqual([]);
    expect(plan.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
