// Decision — record what was chosen and why. Co-signed.
// Spec: docs/artifacts.md § 6.

import { z } from "zod";

import { BaseArtifactSchema, applyCommonDefaults } from "./common.js";

export const DecisionSchema = BaseArtifactSchema.extend({
  type: z.literal("Decision"),
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(1),
  chosen: z.string().min(1),
  rationale: z.string().min(1),
  signed_by: z.array(z.string().min(1)).min(1),
  // `expires` is either an ISO-8601 timestamp or null (no expiry).
  expires: z.string().datetime({ offset: true }).nullable(),
});

export type Decision = z.infer<typeof DecisionSchema>;

export const isDecision = (x: unknown): x is Decision =>
  DecisionSchema.safeParse(x).success;

export function createDecision(
  input: Omit<
    Decision,
    "type" | "created" | "version" | "supersedes" | "signatures"
  > &
    Partial<Pick<Decision, "created" | "version" | "supersedes" | "signatures">>,
): Decision {
  return DecisionSchema.parse({
    type: "Decision",
    ...applyCommonDefaults(input),
  });
}
