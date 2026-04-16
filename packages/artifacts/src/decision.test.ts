import { describe, it, expect } from "vitest";

import { DecisionSchema, createDecision, isDecision } from "./decision.js";

const valid = {
  id: "dcs_4f2",
  type: "Decision" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  question: "Which cache/session backend for v2?",
  options: ["Redis", "DynamoDB", "in-memory+sticky"],
  chosen: "DynamoDB",
  rationale: "Eliminates Redis as per 2026-Q3 cost initiative",
  signed_by: ["claude", "codex", "human:david"],
  expires: null,
};

describe("DecisionSchema", () => {
  it("accepts the docs/artifacts.md § 6 example", () => {
    expect(DecisionSchema.parse(valid)).toEqual(valid);
    expect(isDecision(valid)).toBe(true);
  });

  it("accepts an ISO expiry", () => {
    const withExpiry = { ...valid, expires: "2026-12-31T23:59:59Z" };
    expect(DecisionSchema.safeParse(withExpiry).success).toBe(true);
  });

  it("rejects a non-ISO expiry string", () => {
    expect(
      DecisionSchema.safeParse({ ...valid, expires: "soon" }).success,
    ).toBe(false);
  });

  it("rejects empty options array", () => {
    expect(DecisionSchema.safeParse({ ...valid, options: [] }).success).toBe(
      false,
    );
  });

  it("rejects empty signed_by", () => {
    expect(DecisionSchema.safeParse({ ...valid, signed_by: [] }).success).toBe(
      false,
    );
  });

  it("rejects a wrong type literal", () => {
    expect(DecisionSchema.safeParse({ ...valid, type: "Plan" }).success).toBe(
      false,
    );
  });

  it("createDecision fills in defaults", () => {
    const d = createDecision({
      id: "dcs_aa",
      author: "claude",
      project: "p",
      question: "q",
      options: ["a", "b"],
      chosen: "a",
      rationale: "r",
      signed_by: ["claude"],
      expires: null,
    });
    expect(d.type).toBe("Decision");
  });
});
