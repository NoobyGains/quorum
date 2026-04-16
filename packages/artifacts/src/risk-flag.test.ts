import { describe, it, expect } from "vitest";

import {
  RiskFlagSchema,
  createRiskFlag,
  isRiskFlag,
} from "./risk-flag.js";

const valid = {
  id: "rsk_01",
  type: "RiskFlag" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  target: "pln_9c2",
  severity: "medium" as const,
  category: "scalability" as const,
  description: "In-memory LRU breaks at >2 nodes without sticky sessions",
  mitigation: "Revisit at 4+ nodes; track in issue #99",
};

describe("RiskFlagSchema", () => {
  it("accepts the docs/artifacts.md § 12 example", () => {
    expect(RiskFlagSchema.parse(valid)).toEqual(valid);
    expect(isRiskFlag(valid)).toBe(true);
  });

  it("accepts a `commit:<sha>` target form", () => {
    expect(
      RiskFlagSchema.safeParse({ ...valid, target: "commit:c81fa03" }).success,
    ).toBe(true);
  });

  it("rejects invalid severity", () => {
    expect(
      RiskFlagSchema.safeParse({ ...valid, severity: "apocalyptic" }).success,
    ).toBe(false);
  });

  it("rejects invalid category", () => {
    expect(
      RiskFlagSchema.safeParse({ ...valid, category: "vibes" }).success,
    ).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(
      RiskFlagSchema.safeParse({ ...valid, type: "Plan" }).success,
    ).toBe(false);
  });

  it("rejects missing description", () => {
    const { description: _d, ...rest } = valid;
    void _d;
    expect(RiskFlagSchema.safeParse(rest).success).toBe(false);
  });

  it("createRiskFlag fills in defaults", () => {
    const r = createRiskFlag({
      id: "rsk_aa",
      author: "claude",
      project: "p",
      target: "pln_01",
      severity: "low",
      category: "debt",
      description: "d",
      mitigation: "m",
    });
    expect(r.type).toBe("RiskFlag");
  });
});
