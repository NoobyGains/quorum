import { describe, it, expect } from "vitest";

import { ResultSchema, createResult, isResult } from "./result.js";

const valid = {
  id: "res_01",
  type: "Result" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  experiment_id: "exp_3f",
  observed: "22% 500s, concentrated on expired-token path",
  surprised_me: true,
  next: "new Hypothesis: token cache eviction is racy",
};

describe("ResultSchema", () => {
  it("accepts the docs/artifacts.md § 5 example", () => {
    expect(ResultSchema.parse(valid)).toEqual(valid);
    expect(isResult(valid)).toBe(true);
  });

  it("rejects missing experiment_id", () => {
    const { experiment_id: _e, ...rest } = valid;
    void _e;
    expect(ResultSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(ResultSchema.safeParse({ ...valid, type: "Plan" }).success).toBe(
      false,
    );
  });

  it("rejects non-boolean surprised_me", () => {
    expect(
      ResultSchema.safeParse({ ...valid, surprised_me: "yes" }).success,
    ).toBe(false);
  });

  it("createResult fills in defaults", () => {
    const r = createResult({
      id: "res_aa",
      author: "claude",
      project: "p",
      experiment_id: "exp_01",
      observed: "o",
      surprised_me: false,
      next: "n",
    });
    expect(r.type).toBe("Result");
  });
});
