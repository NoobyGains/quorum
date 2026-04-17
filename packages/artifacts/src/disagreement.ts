// Disagreement — structured debate, 3-round cap.
// Spec: docs/artifacts.md § 9.

import { z } from "zod";

import {
  BaseArtifactSchema,
  DisagreementSeveritySchema,
  DisagreementStatusSchema,
  applyCommonDefaults,
} from "./common.js";

/**
 * A single round in a Disagreement. The spec shows `rounds: [{ /* replies *\/ }]`
 * without pinning an exact structure, so we define a minimal, stable shape:
 * who replied, what they said, and when. This can be extended in a schema
 * migration later without breaking existing data.
 */
export const DisagreementRoundSchema = z.object({
  agent: z.string().min(1),
  reply: z.string().min(1),
  at: z.string().datetime(),
});

export type DisagreementRound = z.infer<typeof DisagreementRoundSchema>;

export const DisagreementSchema = BaseArtifactSchema.extend({
  type: z.literal("Disagreement"),
  target: z.string().min(1),
  thesis_agent: z.string().min(1),
  thesis: z.string().min(1),
  antithesis_agent: z.string().min(1),
  antithesis: z.string().min(1),
  evidence: z.array(z.string()),
  severity: DisagreementSeveritySchema,
  // The 3-round cap is enforced here at the schema layer; protocol logic
  // (M2) will be responsible for escalating past round 3.
  rounds: z.array(DisagreementRoundSchema).max(3),
  status: DisagreementStatusSchema,
});

export type Disagreement = z.infer<typeof DisagreementSchema>;

export const isDisagreement = (x: unknown): x is Disagreement =>
  DisagreementSchema.safeParse(x).success;

export function createDisagreement(
  input: Omit<
    Disagreement,
    "type" | "created" | "version" | "supersedes" | "signatures"
  > &
    Partial<
      Pick<Disagreement, "created" | "version" | "supersedes" | "signatures">
    >,
): Disagreement {
  return DisagreementSchema.parse({
    type: "Disagreement",
    ...applyCommonDefaults(input),
  });
}
