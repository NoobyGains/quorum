import { describe, it, expect } from "vitest";

import {
  CommitmentSchema,
  createCommitment,
  isCommitment,
} from "./commitment.js";

const valid = {
  id: "cmt_2b",
  type: "Commitment" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  what: "Ship fix for issue #47",
  by_when: "2026-04-16T18:00:00Z",
  to_whom: ["codex", "human:david"],
  status: "open" as const,
};

describe("CommitmentSchema", () => {
  it("accepts the docs/artifacts.md § 8 example", () => {
    expect(CommitmentSchema.parse(valid)).toEqual(valid);
    expect(isCommitment(valid)).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(
      CommitmentSchema.safeParse({ ...valid, status: "pending" }).success,
    ).toBe(false);
  });

  it("rejects non-ISO by_when", () => {
    expect(
      CommitmentSchema.safeParse({ ...valid, by_when: "soon" }).success,
    ).toBe(false);
  });

  it("rejects empty to_whom", () => {
    expect(
      CommitmentSchema.safeParse({ ...valid, to_whom: [] }).success,
    ).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(
      CommitmentSchema.safeParse({ ...valid, type: "Plan" }).success,
    ).toBe(false);
  });

  it("createCommitment fills in defaults", () => {
    const c = createCommitment({
      id: "cmt_aa",
      author: "claude",
      project: "p",
      what: "w",
      by_when: "2026-04-16T18:00:00Z",
      to_whom: ["codex"],
      status: "open",
    });
    expect(c.type).toBe("Commitment");
  });
});
