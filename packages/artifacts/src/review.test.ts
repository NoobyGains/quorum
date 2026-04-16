import { describe, it, expect } from "vitest";

import { ReviewSchema, createReview, isReview } from "./review.js";

const valid = {
  id: "rev_2a",
  type: "Review" as const,
  author: "codex",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  target_commit: "c81fa03",
  target_plan: "pln_9c2",
  reviewer: "codex",
  verdict: "approve" as const,
  notes: [
    {
      file: "auth.ts",
      line: 47,
      severity: "must_fix" as const,
      category: "security" as const,
      comment: "user_id flows unescaped into SQL...",
    },
  ],
  cites: ["dcs_4f2"],
};

describe("ReviewSchema", () => {
  it("accepts the docs/artifacts.md § 11 example", () => {
    expect(ReviewSchema.parse(valid)).toEqual(valid);
    expect(isReview(valid)).toBe(true);
  });

  it("rejects invalid verdict", () => {
    expect(
      ReviewSchema.safeParse({ ...valid, verdict: "maybe" }).success,
    ).toBe(false);
  });

  it("rejects invalid note severity", () => {
    const bad = {
      ...valid,
      notes: [{ ...valid.notes[0], severity: "yolo" }],
    };
    expect(ReviewSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects invalid note category", () => {
    const bad = {
      ...valid,
      notes: [{ ...valid.notes[0], category: "vibes" }],
    };
    expect(ReviewSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects malformed target_commit", () => {
    expect(
      ReviewSchema.safeParse({ ...valid, target_commit: "XYZ" }).success,
    ).toBe(false);
    expect(
      ReviewSchema.safeParse({ ...valid, target_commit: "abc" }).success,
    ).toBe(false);
  });

  it("rejects malformed cite id", () => {
    expect(
      ReviewSchema.safeParse({ ...valid, cites: ["BAD-ID"] }).success,
    ).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(ReviewSchema.safeParse({ ...valid, type: "Plan" }).success).toBe(
      false,
    );
  });

  it("createReview fills in defaults", () => {
    const r = createReview({
      id: "rev_aa",
      author: "codex",
      project: "p",
      target_commit: "abcdef0",
      target_plan: "pln_01",
      reviewer: "codex",
      verdict: "approve",
      notes: [],
      cites: [],
    });
    expect(r.type).toBe("Review");
  });
});
