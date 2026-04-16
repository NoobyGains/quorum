// Hypothesis — express uncertainty ("I think X because Y").
// Spec: docs/artifacts.md § 3.

import { z } from "zod";

import {
  BaseArtifactSchema,
  ConfidenceSchema,
  applyCommonDefaults,
} from "./common.js";

export const HypothesisSchema = BaseArtifactSchema.extend({
  type: z.literal("Hypothesis"),
  statement: z.string().min(1),
  evidence_for: z.array(z.string()),
  evidence_against: z.array(z.string()),
  confidence: ConfidenceSchema,
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const isHypothesis = (x: unknown): x is Hypothesis =>
  HypothesisSchema.safeParse(x).success;

export function createHypothesis(
  input: Omit<
    Hypothesis,
    "type" | "created" | "version" | "supersedes" | "signatures"
  > &
    Partial<Pick<Hypothesis, "created" | "version" | "supersedes" | "signatures">>,
): Hypothesis {
  return HypothesisSchema.parse({
    type: "Hypothesis",
    ...applyCommonDefaults(input),
  });
}
