// @quorum/artifacts — Zod schemas for the 12 typed artifact types.
// Spec: docs/artifacts.md. This file wires the per-type schemas into a
// single discriminated union keyed on `type`.

import { z } from "zod";

import { ClaimSchema } from "./claim.js";
import { CommitmentSchema } from "./commitment.js";
import { DecisionSchema } from "./decision.js";
import { DisagreementSchema } from "./disagreement.js";
import { ExperimentSchema } from "./experiment.js";
import { HandoffSchema } from "./handoff.js";
import { HypothesisSchema } from "./hypothesis.js";
import { PlanSchema } from "./plan.js";
import { QuestionSchema } from "./question.js";
import { ResultSchema } from "./result.js";
import { ReviewSchema } from "./review.js";
import { RiskFlagSchema } from "./risk-flag.js";

/**
 * The discriminated union over all 12 artifact types. Keyed on `type`, which
 * each per-type schema narrows to a `z.literal(...)`.
 *
 * Use this at any boundary where an artifact of unknown concrete type arrives
 * (storage reads, MCP tool inputs, git-hook payloads) so that the narrowing
 * falls out of a single parse rather than 12 ad-hoc checks.
 */
export const ArtifactSchema = z.discriminatedUnion("type", [
  PlanSchema,
  ClaimSchema,
  HypothesisSchema,
  ExperimentSchema,
  ResultSchema,
  DecisionSchema,
  QuestionSchema,
  CommitmentSchema,
  DisagreementSchema,
  HandoffSchema,
  ReviewSchema,
  RiskFlagSchema,
]);

export type Artifact = z.infer<typeof ArtifactSchema>;

/**
 * Convenience type guard over the full union. For per-type guards, import
 * `isPlan`, `isClaim`, etc. from their respective modules (re-exported below).
 */
export const isArtifact = (x: unknown): x is Artifact =>
  ArtifactSchema.safeParse(x).success;

/**
 * The literal set of `type` discriminators. Useful for exhaustive switches
 * and for generating id prefixes in callers.
 */
export const ARTIFACT_TYPES = [
  "Plan",
  "Claim",
  "Hypothesis",
  "Experiment",
  "Result",
  "Decision",
  "Question",
  "Commitment",
  "Disagreement",
  "Handoff",
  "Review",
  "RiskFlag",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const ARTIFACT_PACKAGE_VERSION = "0.0.1" as const;

// Re-export everything so consumers can `import { PlanSchema, createReview, ... }`
// from "@quorum/artifacts" without reaching into sub-paths.
export * from "./common.js";
export * from "./plan.js";
export * from "./claim.js";
export * from "./hypothesis.js";
export * from "./experiment.js";
export * from "./result.js";
export * from "./decision.js";
export * from "./question.js";
export * from "./commitment.js";
export * from "./disagreement.js";
export * from "./handoff.js";
export * from "./review.js";
export * from "./risk-flag.js";
