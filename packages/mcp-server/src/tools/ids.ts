// Artifact id generation for MCP create tools.
//
// Ids follow the shape `<prefix>_<shortHash>` (spec: docs/artifacts.md §
// Common fields, and the M1 Wave 3 assignment). The prefix is a stable
// per-type abbreviation; the hash is sha1 over a salted tuple that makes
// collisions astronomically unlikely at this scope.

import { createHash, randomBytes } from "node:crypto";

import type { ArtifactType } from "@quorum/artifacts";

/**
 * Per-type id prefix. Kept in sync with the assignment's enumeration — the
 * values are also consumed by the ArtifactIdSchema regex (`^[a-z]+_[a-z0-9]+$`).
 */
export const ID_PREFIX: Record<ArtifactType, string> = {
  Plan: "pln",
  Claim: "clm",
  Hypothesis: "hyp",
  Experiment: "exp",
  Result: "res",
  Decision: "dcs",
  Question: "qst",
  Commitment: "cmt",
  Disagreement: "dsg",
  Handoff: "hnd",
  Review: "rev",
  RiskFlag: "rsk",
};

/**
 * Compute a deterministic short hash from a tuple of (type, author, created,
 * random salt). We include a random salt so two create calls with identical
 * (type, author, created) inputs — which is possible in fast tests — still
 * produce different ids.
 */
export function shortHash(
  type: ArtifactType,
  author: string,
  created: string,
): string {
  const salt = randomBytes(8).toString("hex");
  return createHash("sha1")
    .update(`${type}|${author}|${created}|${salt}`)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Generate a fresh id for the given artifact type.
 * The `created` timestamp is generated here so it matches what the factory
 * will stamp onto the artifact when no override is provided.
 */
export function generateId(type: ArtifactType, author: string): string {
  const created = new Date().toISOString();
  return `${ID_PREFIX[type]}_${shortHash(type, author, created)}`;
}
