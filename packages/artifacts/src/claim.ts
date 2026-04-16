// Claim — exclusive lock on an issue, feature, or file pattern.
// Spec: docs/artifacts.md § 2.

import { z } from "zod";

import { BaseArtifactSchema, applyCommonDefaults } from "./common.js";

export const ClaimSchema = BaseArtifactSchema.extend({
  type: z.literal("Claim"),
  target: z.string().min(1),
  agent: z.string().min(1),
  exclusive: z.boolean(),
  ttl_seconds: z.number().int().positive(),
  reason: z.string().min(1),
});

export type Claim = z.infer<typeof ClaimSchema>;

export const isClaim = (x: unknown): x is Claim =>
  ClaimSchema.safeParse(x).success;

export function createClaim(
  input: Omit<Claim, "type" | "created" | "version" | "supersedes" | "signatures"> &
    Partial<Pick<Claim, "created" | "version" | "supersedes" | "signatures">>,
): Claim {
  return ClaimSchema.parse({
    type: "Claim",
    ...applyCommonDefaults(input),
  });
}
