// Experiment — plan to test a hypothesis. Spec: docs/artifacts.md § 4.

import { z } from "zod";

import {
  ArtifactIdSchema,
  BaseArtifactSchema,
  applyCommonDefaults,
} from "./common.js";

export const ExperimentSchema = BaseArtifactSchema.extend({
  type: z.literal("Experiment"),
  hypothesis_id: ArtifactIdSchema,
  method: z.string().min(1),
  expected: z.string().min(1),
});

export type Experiment = z.infer<typeof ExperimentSchema>;

export const isExperiment = (x: unknown): x is Experiment =>
  ExperimentSchema.safeParse(x).success;

export function createExperiment(
  input: Omit<
    Experiment,
    "type" | "created" | "version" | "supersedes" | "signatures"
  > &
    Partial<Pick<Experiment, "created" | "version" | "supersedes" | "signatures">>,
): Experiment {
  return ExperimentSchema.parse({
    type: "Experiment",
    ...applyCommonDefaults(input),
  });
}
