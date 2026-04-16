// Review — merge gate. Signed by a peer of the OTHER vendor.
// Spec: docs/artifacts.md § 11.

import { z } from "zod";

import {
  ArtifactIdSchema,
  BaseArtifactSchema,
  NoteCategorySchema,
  NoteSeveritySchema,
  ReviewVerdictSchema,
  applyCommonDefaults,
} from "./common.js";

/** A single review note tied to a file/line. */
export const ReviewNoteSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  severity: NoteSeveritySchema,
  category: NoteCategorySchema,
  comment: z.string().min(1),
});

export type ReviewNote = z.infer<typeof ReviewNoteSchema>;

export const ReviewSchema = BaseArtifactSchema.extend({
  type: z.literal("Review"),
  // Git commit SHA. Accept both short (7+) and full (40) lowercase hex.
  target_commit: z.string().regex(/^[0-9a-f]{7,40}$/, "target_commit must be a git sha"),
  target_plan: ArtifactIdSchema,
  reviewer: z.string().min(1),
  verdict: ReviewVerdictSchema,
  notes: z.array(ReviewNoteSchema),
  cites: z.array(ArtifactIdSchema),
});

export type Review = z.infer<typeof ReviewSchema>;

export const isReview = (x: unknown): x is Review =>
  ReviewSchema.safeParse(x).success;

export function createReview(
  input: Omit<Review, "type" | "created" | "version" | "supersedes" | "signatures"> &
    Partial<Pick<Review, "created" | "version" | "supersedes" | "signatures">>,
): Review {
  return ReviewSchema.parse({
    type: "Review",
    ...applyCommonDefaults(input),
  });
}
