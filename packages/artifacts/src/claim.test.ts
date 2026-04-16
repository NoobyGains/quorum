import { describe, it, expect } from "vitest";

import { ClaimSchema, createClaim, isClaim } from "./claim.js";

const valid = {
  id: "clm_47",
  type: "Claim" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  target: "gh-issue-47",
  agent: "claude",
  exclusive: true,
  ttl_seconds: 3600,
  reason: "starting rate-limit work",
};

describe("ClaimSchema", () => {
  it("accepts the docs/artifacts.md § 2 example", () => {
    expect(ClaimSchema.parse(valid)).toEqual(valid);
    expect(isClaim(valid)).toBe(true);
  });

  it("rejects a missing `target`", () => {
    const { target: _t, ...rest } = valid;
    void _t;
    expect(ClaimSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(ClaimSchema.safeParse({ ...valid, type: "Plan" }).success).toBe(
      false,
    );
  });

  it("rejects non-positive ttl_seconds", () => {
    expect(ClaimSchema.safeParse({ ...valid, ttl_seconds: 0 }).success).toBe(
      false,
    );
    expect(ClaimSchema.safeParse({ ...valid, ttl_seconds: -1 }).success).toBe(
      false,
    );
  });

  it("rejects non-boolean exclusive", () => {
    expect(ClaimSchema.safeParse({ ...valid, exclusive: "yes" }).success).toBe(
      false,
    );
  });

  it("createClaim fills in defaults", () => {
    const c = createClaim({
      id: "clm_99",
      author: "claude",
      project: "p",
      target: "file:src/**",
      agent: "claude",
      exclusive: true,
      ttl_seconds: 60,
      reason: "test",
    });
    expect(c.type).toBe("Claim");
    expect(c.signatures).toEqual([]);
  });
});
