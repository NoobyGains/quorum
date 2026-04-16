// Handoff — end-of-turn state package. Spec: docs/artifacts.md § 10.

import { z } from "zod";

import { BaseArtifactSchema, applyCommonDefaults } from "./common.js";

export const HandoffSchema = BaseArtifactSchema.extend({
  type: z.literal("Handoff"),
  from: z.string().min(1),
  summary: z.string().min(1),
  // The spec's example has `what_failed` as a string; real turns may have
  // nothing to report here, so nullable is appropriate.
  what_failed: z.string().nullable(),
  lesson: z.string().nullable(),
  open_questions: z.array(z.string()),
  suggested_next: z.string().nullable(),
  // Drift in [-1, 1]: a delta applied to the author's prior calibration.
  confidence_drift: z.number().min(-1).max(1),
});

export type Handoff = z.infer<typeof HandoffSchema>;

export const isHandoff = (x: unknown): x is Handoff =>
  HandoffSchema.safeParse(x).success;

export function createHandoff(
  input: Omit<
    Handoff,
    "type" | "created" | "version" | "supersedes" | "signatures"
  > &
    Partial<Pick<Handoff, "created" | "version" | "supersedes" | "signatures">>,
): Handoff {
  return HandoffSchema.parse({
    type: "Handoff",
    ...applyCommonDefaults(input),
  });
}
