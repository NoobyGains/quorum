import { describe, it, expect } from "vitest";

import {
  HypothesisSchema,
  createHypothesis,
  isHypothesis,
} from "./hypothesis.js";

const valid = {
  id: "hyp_7c",
  type: "Hypothesis" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  statement: "The 500s on /users are from the rate-limit bypass path",
  evidence_for: ["logs from 14:02:17 show ...", "related issue #38"],
  evidence_against: [],
  confidence: 0.7,
};

describe("HypothesisSchema", () => {
  it("accepts the docs/artifacts.md § 3 example", () => {
    expect(HypothesisSchema.parse(valid)).toEqual(valid);
    expect(isHypothesis(valid)).toBe(true);
  });

  it("rejects a missing statement", () => {
    const { statement: _s, ...rest } = valid;
    void _s;
    expect(HypothesisSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(
      HypothesisSchema.safeParse({ ...valid, type: "Claim" }).success,
    ).toBe(false);
  });

  it("rejects confidence outside [0, 1]", () => {
    expect(
      HypothesisSchema.safeParse({ ...valid, confidence: 2 }).success,
    ).toBe(false);
  });

  it("rejects non-array evidence", () => {
    expect(
      HypothesisSchema.safeParse({ ...valid, evidence_for: "logs" }).success,
    ).toBe(false);
  });

  it("createHypothesis fills in defaults", () => {
    const h = createHypothesis({
      id: "hyp_99",
      author: "claude",
      project: "p",
      statement: "x",
      evidence_for: [],
      evidence_against: [],
      confidence: 0.5,
    });
    expect(h.type).toBe("Hypothesis");
    expect(h.version).toBe(1);
  });
});
