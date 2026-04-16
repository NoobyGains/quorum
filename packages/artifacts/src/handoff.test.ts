import { describe, it, expect } from "vitest";

import { HandoffSchema, createHandoff, isHandoff } from "./handoff.js";

const valid = {
  id: "hnd_01",
  type: "Handoff" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  from: "claude",
  summary: "Shipped #47. Original Redis plan blocked — resolved in 1 round.",
  what_failed: "Initial plan missed Redis-elimination decision",
  lesson: "Query refs/coord/decisions/ before infra choices",
  open_questions: [],
  suggested_next: "#48 — similar endpoint needs same treatment",
  confidence_drift: -0.02,
};

describe("HandoffSchema", () => {
  it("accepts the docs/artifacts.md § 10 example", () => {
    expect(HandoffSchema.parse(valid)).toEqual(valid);
    expect(isHandoff(valid)).toBe(true);
  });

  it("accepts null for optional what_failed / lesson / suggested_next", () => {
    expect(
      HandoffSchema.safeParse({
        ...valid,
        what_failed: null,
        lesson: null,
        suggested_next: null,
      }).success,
    ).toBe(true);
  });

  it("rejects confidence_drift out of range", () => {
    expect(
      HandoffSchema.safeParse({ ...valid, confidence_drift: 2 }).success,
    ).toBe(false);
    expect(
      HandoffSchema.safeParse({ ...valid, confidence_drift: -2 }).success,
    ).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(HandoffSchema.safeParse({ ...valid, type: "Plan" }).success).toBe(
      false,
    );
  });

  it("rejects missing summary", () => {
    const { summary: _s, ...rest } = valid;
    void _s;
    expect(HandoffSchema.safeParse(rest).success).toBe(false);
  });

  it("createHandoff fills in defaults", () => {
    const h = createHandoff({
      id: "hnd_aa",
      author: "claude",
      project: "p",
      from: "claude",
      summary: "done",
      what_failed: null,
      lesson: null,
      open_questions: [],
      suggested_next: null,
      confidence_drift: 0,
    });
    expect(h.type).toBe("Handoff");
  });
});
