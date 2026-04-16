// Question — blocking inquiry directed to another agent or human.
// Spec: docs/artifacts.md § 7.

import { z } from "zod";

import { BaseArtifactSchema, applyCommonDefaults } from "./common.js";

export const QuestionSchema = BaseArtifactSchema.extend({
  type: z.literal("Question"),
  text: z.string().min(1),
  blocking: z.boolean(),
  addressed_to: z.array(z.string().min(1)).min(1),
  context: z.array(z.string()),
});

export type Question = z.infer<typeof QuestionSchema>;

export const isQuestion = (x: unknown): x is Question =>
  QuestionSchema.safeParse(x).success;

export function createQuestion(
  input: Omit<
    Question,
    "type" | "created" | "version" | "supersedes" | "signatures"
  > &
    Partial<Pick<Question, "created" | "version" | "supersedes" | "signatures">>,
): Question {
  return QuestionSchema.parse({
    type: "Question",
    ...applyCommonDefaults(input),
  });
}
