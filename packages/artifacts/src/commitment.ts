// Commitment — "I will do X by Y." Spec: docs/artifacts.md § 8.

import { z } from "zod";

import {
  BaseArtifactSchema,
  CommitmentStatusSchema,
  applyCommonDefaults,
} from "./common.js";

export const CommitmentSchema = BaseArtifactSchema.extend({
  type: z.literal("Commitment"),
  what: z.string().min(1),
  by_when: z.string().datetime(),
  to_whom: z.array(z.string().min(1)).min(1),
  status: CommitmentStatusSchema,
});

export type Commitment = z.infer<typeof CommitmentSchema>;

export const isCommitment = (x: unknown): x is Commitment =>
  CommitmentSchema.safeParse(x).success;

export function createCommitment(
  input: Omit<
    Commitment,
    "type" | "created" | "version" | "supersedes" | "signatures"
  > &
    Partial<Pick<Commitment, "created" | "version" | "supersedes" | "signatures">>,
): Commitment {
  return CommitmentSchema.parse({
    type: "Commitment",
    ...applyCommonDefaults(input),
  });
}
