// Plan — declare intent before editing code. Spec: docs/artifacts.md § 1.

import { z } from "zod";

import {
  BaseArtifactSchema,
  BlastRadiusSchema,
  ConfidenceSchema,
  PlanStatusSchema,
  SeveritySchema,
  applyCommonDefaults,
} from "./common.js";

/**
 * Embedded risk-flag on a Plan. This is _not_ the standalone `RiskFlag`
 * artifact — it's a lightweight inline structure matching the example in
 * docs/artifacts.md ("risk_flags": [{ "severity": "...", "mitigation": "..." }]).
 */
export const PlanRiskFlagSchema = z.object({
  severity: SeveritySchema,
  mitigation: z.string().min(1),
});

export const PlanSchema = BaseArtifactSchema.extend({
  type: z.literal("Plan"),
  goal: z.string().min(1),
  approach: z.string().min(1),
  files_touched: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
  confidence: ConfidenceSchema,
  blast_radius: BlastRadiusSchema,
  estimated_tokens: z.number().int().nonnegative(),
  risk_flags: z.array(PlanRiskFlagSchema),
  status: PlanStatusSchema,
});

export type Plan = z.infer<typeof PlanSchema>;

export const isPlan = (x: unknown): x is Plan => PlanSchema.safeParse(x).success;

/**
 * Factory that fills in common bookkeeping fields with sensible defaults
 * (`created = now`, `version = 1`, `supersedes = null`, `signatures = []`).
 *
 * Callers must still supply `id`, `author`, `project`, and all Plan-specific
 * fields. Returns a validated `Plan` (throws if the final object doesn't
 * match the schema).
 */
export function createPlan(
  input: Omit<Plan, "type" | "created" | "version" | "supersedes" | "signatures"> &
    Partial<Pick<Plan, "created" | "version" | "supersedes" | "signatures">>,
): Plan {
  return PlanSchema.parse({
    type: "Plan",
    ...applyCommonDefaults(input),
  });
}
