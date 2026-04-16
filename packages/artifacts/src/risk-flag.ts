// RiskFlag — surface concerns that don't block now but should be tracked.
// Spec: docs/artifacts.md § 12.

import { z } from "zod";

import {
  BaseArtifactSchema,
  RiskCategorySchema,
  SeveritySchema,
  applyCommonDefaults,
} from "./common.js";

export const RiskFlagSchema = BaseArtifactSchema.extend({
  type: z.literal("RiskFlag"),
  // `target` is free-form per spec (e.g. "pln_9c2" or "commit:c81fa03"); we
  // just require a non-empty string and leave resolution to the caller.
  target: z.string().min(1),
  severity: SeveritySchema,
  category: RiskCategorySchema,
  description: z.string().min(1),
  mitigation: z.string().min(1),
});

export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const isRiskFlag = (x: unknown): x is RiskFlag =>
  RiskFlagSchema.safeParse(x).success;

export function createRiskFlag(
  input: Omit<
    RiskFlag,
    "type" | "created" | "version" | "supersedes" | "signatures"
  > &
    Partial<Pick<RiskFlag, "created" | "version" | "supersedes" | "signatures">>,
): RiskFlag {
  return RiskFlagSchema.parse({
    type: "RiskFlag",
    ...applyCommonDefaults(input),
  });
}
