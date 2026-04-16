// Result — what happened when you ran an experiment. Spec: docs/artifacts.md § 5.

import { z } from "zod";

import {
  ArtifactIdSchema,
  BaseArtifactSchema,
  applyCommonDefaults,
} from "./common.js";

export const ResultSchema = BaseArtifactSchema.extend({
  type: z.literal("Result"),
  experiment_id: ArtifactIdSchema,
  observed: z.string().min(1),
  surprised_me: z.boolean(),
  next: z.string().min(1),
});

export type Result = z.infer<typeof ResultSchema>;

export const isResult = (x: unknown): x is Result =>
  ResultSchema.safeParse(x).success;

export function createResult(
  input: Omit<Result, "type" | "created" | "version" | "supersedes" | "signatures"> &
    Partial<Pick<Result, "created" | "version" | "supersedes" | "signatures">>,
): Result {
  return ResultSchema.parse({
    type: "Result",
    ...applyCommonDefaults(input),
  });
}
