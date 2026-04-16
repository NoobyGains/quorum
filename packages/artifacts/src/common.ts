// Common base schema + shared enums for all 12 artifact types.
// Spec: docs/artifacts.md § Common fields.

import { z } from "zod";

/**
 * Artifact id shape: type-prefix + short hash, lowercase alphanumerics.
 *
 * Examples: "pln_9c1", "dcs_4f2", "rev_2a".
 * The prefix is a lowercase ASCII string; the suffix is lowercase alphanumerics.
 * Kept intentionally permissive so new prefixes can be introduced without a
 * schema change — the _type_ discriminator is the authoritative check.
 */
export const ArtifactIdSchema = z
  .string()
  .regex(/^[a-z]+_[a-z0-9]+$/, "artifact id must be <prefix>_<alnum>");

/**
 * A single Ed25519-style signature entry. The `sig` field is an opaque string
 * at this layer; cryptographic verification lives in the git/storage layer.
 */
export const SignatureSchema = z.object({
  signer: z.string().min(1),
  sig: z.string().min(1),
});

/**
 * Fields shared by every artifact. Per-type schemas extend this via `.extend`.
 *
 * `type` is deliberately a generic string here; each concrete artifact schema
 * narrows it to a `z.literal(...)` so the discriminated union in `index.ts`
 * can key off of it.
 */
export const BaseArtifactSchema = z.object({
  id: ArtifactIdSchema,
  type: z.string(),
  author: z.string().min(1),
  created: z.string().datetime({ offset: true }),
  project: z.string().min(1),
  version: z.number().int().nonnegative(),
  supersedes: ArtifactIdSchema.nullable(),
  signatures: z.array(SignatureSchema),
});

export type BaseArtifact = z.infer<typeof BaseArtifactSchema>;

// --- Shared enums ------------------------------------------------------------

/** Generic severity scale. Used by RiskFlag and Plan.risk_flags entries. */
export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

/** Blast radius used by Plan. */
export const BlastRadiusSchema = z.enum(["small", "medium", "large"]);
export type BlastRadius = z.infer<typeof BlastRadiusSchema>;

/** Plan lifecycle status. */
export const PlanStatusSchema = z.enum([
  "objection_window",
  "approved",
  "blocked",
  "superseded",
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

/** Commitment lifecycle status. */
export const CommitmentStatusSchema = z.enum(["open", "met", "missed"]);
export type CommitmentStatus = z.infer<typeof CommitmentStatusSchema>;

/** Disagreement lifecycle status. */
export const DisagreementStatusSchema = z.enum([
  "open",
  "resolved",
  "escalated_to_human",
]);
export type DisagreementStatus = z.infer<typeof DisagreementStatusSchema>;

/**
 * Disagreement severity. The spec's example uses `"blocks_merge"`, so we keep
 * that as the canonical strong-stop value and add symmetrical neighbours.
 */
export const DisagreementSeveritySchema = z.enum([
  "advisory",
  "blocks_merge",
  "blocks_action",
]);
export type DisagreementSeverity = z.infer<typeof DisagreementSeveritySchema>;

/** Peer review verdict. */
export const ReviewVerdictSchema = z.enum([
  "approve",
  "request_changes",
  "block",
]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

/** Per-note severity inside a Review. */
export const NoteSeveritySchema = z.enum(["must_fix", "should_fix", "nit"]);
export type NoteSeverity = z.infer<typeof NoteSeveritySchema>;

/** Per-note category inside a Review. */
export const NoteCategorySchema = z.enum([
  "security",
  "race",
  "coverage",
  "style",
  "logic",
]);
export type NoteCategory = z.infer<typeof NoteCategorySchema>;

/** RiskFlag category. */
export const RiskCategorySchema = z.enum([
  "scalability",
  "security",
  "debt",
  "migration",
]);
export type RiskCategory = z.infer<typeof RiskCategorySchema>;

/** Confidence in [0, 1]. */
export const ConfidenceSchema = z.number().min(0).max(1);

// --- Helper types ------------------------------------------------------------

/**
 * The set of fields that `createX` factories require callers to supply. The
 * factories fill in common bookkeeping (`id`, `version`, `supersedes`,
 * `signatures`, `created`) where not provided.
 *
 * Exported so consumers can build their own wrappers on top.
 */
export type CommonFactoryDefaults = {
  id: string;
  created?: string;
  version?: number;
  supersedes?: string | null;
  signatures?: { signer: string; sig: string }[];
};

/**
 * Apply common defaults to a partial artifact input. Used by per-type
 * factories; centralised so the rules are consistent across all 12 types.
 */
export function applyCommonDefaults<T extends { id: string }>(
  input: T &
    Partial<
      Pick<BaseArtifact, "created" | "version" | "supersedes" | "signatures">
    >,
): T & Pick<BaseArtifact, "created" | "version" | "supersedes" | "signatures"> {
  return {
    created: input.created ?? new Date().toISOString(),
    version: input.version ?? 1,
    supersedes: input.supersedes ?? null,
    signatures: input.signatures ?? [],
    ...input,
  };
}
