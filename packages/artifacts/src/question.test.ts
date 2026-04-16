import { describe, it, expect } from "vitest";

import { QuestionSchema, createQuestion, isQuestion } from "./question.js";

const valid = {
  id: "qst_1a",
  type: "Question" as const,
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [],
  text: "Should issue #144 be treated as a bug or intended behavior?",
  blocking: true,
  addressed_to: ["codex", "human:david"],
  context: ["rev_3f", "pln_9c2"],
};

describe("QuestionSchema", () => {
  it("accepts the docs/artifacts.md § 7 example", () => {
    expect(QuestionSchema.parse(valid)).toEqual(valid);
    expect(isQuestion(valid)).toBe(true);
  });

  it("rejects missing text", () => {
    const { text: _t, ...rest } = valid;
    void _t;
    expect(QuestionSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects empty addressed_to", () => {
    expect(
      QuestionSchema.safeParse({ ...valid, addressed_to: [] }).success,
    ).toBe(false);
  });

  it("rejects non-boolean blocking", () => {
    expect(
      QuestionSchema.safeParse({ ...valid, blocking: "yes" }).success,
    ).toBe(false);
  });

  it("rejects a wrong type literal", () => {
    expect(QuestionSchema.safeParse({ ...valid, type: "Plan" }).success).toBe(
      false,
    );
  });

  it("createQuestion fills in defaults", () => {
    const q = createQuestion({
      id: "qst_aa",
      author: "claude",
      project: "p",
      text: "t",
      blocking: false,
      addressed_to: ["codex"],
      context: [],
    });
    expect(q.type).toBe("Question");
  });
});
