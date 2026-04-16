import { describe, it, expect } from "vitest";

import {
  DisagreementSchema,
  createDisagreement,
  isDisagreement,
} from "./disagreement.js";

const valid = {
  id: "dsg_01",
  type: "Disagreement" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  target: "pln_9c1",
  thesis_agent: "claude",
  thesis: "Use Redis for rate limiting",
  antithesis_agent: "codex",
  antithesis: "Redis conflicts with dcs_4f2 (Redis elimination)",
  evidence: ["dcs_4f2", "logs/..."],
  severity: "blocks_merge" as const,
  rounds: [
    {
      agent: "claude",
      reply: "counterpoint",
      at: "2026-04-16T14:35:00Z",
    },
  ],
  status: "open" as const,
};

describe("DisagreementSchema", () => {
  it("accepts the docs/artifacts.md § 9 example shape", () => {
    expect(DisagreementSchema.parse(valid)).toEqual(valid);
    expect(isDisagreement(valid)).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(
      DisagreementSchema.safeParse({ ...valid, status: "closed" }).success,
    ).toBe(false);
  });

  it("rejects invalid severity", () => {
    expect(
      DisagreementSchema.safeParse({ ...valid, severity: "mild" }).success,
    ).toBe(false);
  });

  it("rejects > 3 rounds (protocol cap)", () => {
    const tooMany = {
      ...valid,
      rounds: Array.from({ length: 4 }, (_, i) => ({
        agent: "claude",
        reply: `r${i}`,
        at: "2026-04-16T14:35:00Z",
      })),
    };
    expect(DisagreementSchema.safeParse(tooMany).success).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(
      DisagreementSchema.safeParse({ ...valid, type: "Plan" }).success,
    ).toBe(false);
  });

  it("createDisagreement fills in defaults", () => {
    const d = createDisagreement({
      id: "dsg_aa",
      author: "claude",
      project: "p",
      target: "pln_01",
      thesis_agent: "claude",
      thesis: "t",
      antithesis_agent: "codex",
      antithesis: "a",
      evidence: [],
      severity: "advisory",
      rounds: [],
      status: "open",
    });
    expect(d.type).toBe("Disagreement");
  });
});
