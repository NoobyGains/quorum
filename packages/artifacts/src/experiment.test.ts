import { describe, it, expect } from "vitest";

import {
  ExperimentSchema,
  createExperiment,
  isExperiment,
} from "./experiment.js";

const valid = {
  id: "exp_3f",
  type: "Experiment" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  hypothesis_id: "hyp_7c",
  method: "Hit /users with 150 req/sec for 30s, measure 500s",
  expected: "<=5% 500s if hypothesis is correct",
};

describe("ExperimentSchema", () => {
  it("accepts the docs/artifacts.md § 4 example", () => {
    expect(ExperimentSchema.parse(valid)).toEqual(valid);
    expect(isExperiment(valid)).toBe(true);
  });

  it("rejects missing hypothesis_id", () => {
    const { hypothesis_id: _h, ...rest } = valid;
    void _h;
    expect(ExperimentSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(
      ExperimentSchema.safeParse({ ...valid, type: "Result" }).success,
    ).toBe(false);
  });

  it("rejects malformed hypothesis_id", () => {
    expect(
      ExperimentSchema.safeParse({ ...valid, hypothesis_id: "HYP_7C" }).success,
    ).toBe(false);
  });

  it("createExperiment fills in defaults", () => {
    const e = createExperiment({
      id: "exp_aa",
      author: "claude",
      project: "p",
      hypothesis_id: "hyp_01",
      method: "run",
      expected: "ok",
    });
    expect(e.type).toBe("Experiment");
  });
});
