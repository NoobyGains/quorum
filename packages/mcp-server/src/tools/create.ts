// Create tools — one per artifact type. Each tool:
//   - Validates input args against a Zod schema
//   - Lets the corresponding factory in @quorum/artifacts fill common fields
//     (id is minted here; created/version/supersedes/signatures default)
//   - Writes to the store (which re-validates against ArtifactSchema)
//   - Returns `{ id, type }` on success
//
// The 12 tools are registered from a single array so the surface stays flat.
// Each entry declares its type-specific Zod schema and a builder that
// converts validated args into the per-type factory payload.

import { z } from "zod";

import {
  type Artifact,
  type ArtifactType,
  createClaim,
  createCommitment,
  createDecision,
  createDisagreement,
  createExperiment,
  createHandoff,
  createHypothesis,
  createPlan,
  createQuestion,
  createResult,
  createReview,
  createRiskFlag,
} from "@quorum/artifacts";

import { generateId } from "./ids.js";
import { type ToolDef, textResult } from "./types.js";

// --- Shared fragments --------------------------------------------------------

const AuthorProject = {
  author: z.string().min(1),
  project: z.string().min(1),
};

const Severity = z.enum(["low", "medium", "high", "critical"]);
const BlastRadius = z.enum(["small", "medium", "large"]);
const PlanStatus = z.enum([
  "objection_window",
  "approved",
  "blocked",
  "superseded",
]);
const CommitmentStatus = z.enum(["open", "met", "missed"]);
const DisagreementStatus = z.enum(["open", "resolved", "escalated_to_human"]);
const DisagreementSeverity = z.enum([
  "advisory",
  "blocks_merge",
  "blocks_action",
]);
const ReviewVerdict = z.enum(["approve", "request_changes", "block"]);
const NoteSeverity = z.enum(["must_fix", "should_fix", "nit"]);
const NoteCategory = z.enum([
  "security",
  "race",
  "coverage",
  "style",
  "logic",
]);
const RiskCategory = z.enum(["scalability", "security", "debt", "migration"]);
const Confidence = z.number().min(0).max(1);
const ArtifactId = z
  .string()
  .regex(/^[a-z]+_[a-z0-9]+$/, "artifact id must be <prefix>_<alnum>");

// --- Input schemas + per-type builders ---------------------------------------
//
// Each create tool has a Zod schema for its args and a builder that turns
// those args into an Artifact by calling the corresponding factory. The
// builder is responsible for generating the id and calling the factory; the
// common bookkeeping (created, version, supersedes, signatures) is filled
// by `applyCommonDefaults` inside the factory.

const PlanRiskFlag = z.object({
  severity: Severity,
  mitigation: z.string().min(1),
});

const PlanCreate = z
  .object({
    goal: z.string().min(1),
    approach: z.string().min(1),
    files_touched: z.array(z.string().min(1)),
    assumptions: z.array(z.string().min(1)),
    confidence: Confidence,
    blast_radius: BlastRadius,
    estimated_tokens: z.number().int().nonnegative().optional(),
    risk_flags: z.array(PlanRiskFlag).optional(),
    status: PlanStatus.optional(),
    ...AuthorProject,
  })
  .strict();

const ClaimCreate = z
  .object({
    target: z.string().min(1),
    agent: z.string().min(1),
    exclusive: z.boolean(),
    ttl_seconds: z.number().int().positive(),
    reason: z.string().min(1),
    ...AuthorProject,
  })
  .strict();

const HypothesisCreate = z
  .object({
    statement: z.string().min(1),
    evidence_for: z.array(z.string()),
    evidence_against: z.array(z.string()),
    confidence: Confidence,
    ...AuthorProject,
  })
  .strict();

const ExperimentCreate = z
  .object({
    hypothesis_id: ArtifactId,
    method: z.string().min(1),
    expected: z.string().min(1),
    ...AuthorProject,
  })
  .strict();

const ResultCreate = z
  .object({
    experiment_id: ArtifactId,
    observed: z.string().min(1),
    surprised_me: z.boolean(),
    next: z.string().min(1).optional(),
    ...AuthorProject,
  })
  .strict();

const DecisionCreate = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(1),
    chosen: z.string().min(1),
    rationale: z.string().min(1),
    signed_by: z.array(z.string().min(1)).min(1),
    expires: z.string().datetime({ offset: true }).nullable().optional(),
    ...AuthorProject,
  })
  .strict();

const QuestionCreate = z
  .object({
    text: z.string().min(1),
    blocking: z.boolean(),
    addressed_to: z.array(z.string().min(1)).min(1),
    context: z.array(z.string()).optional(),
    ...AuthorProject,
  })
  .strict();

const CommitmentCreate = z
  .object({
    what: z.string().min(1),
    by_when: z.string().datetime({ offset: true }),
    to_whom: z.array(z.string().min(1)).min(1),
    status: CommitmentStatus.optional(),
    ...AuthorProject,
  })
  .strict();

const DisagreementRound = z.object({
  agent: z.string().min(1),
  reply: z.string().min(1),
  at: z.string().datetime({ offset: true }),
});

const DisagreementCreate = z
  .object({
    target: z.string().min(1),
    thesis_agent: z.string().min(1),
    thesis: z.string().min(1),
    antithesis_agent: z.string().min(1),
    antithesis: z.string().min(1),
    evidence: z.array(z.string()),
    severity: DisagreementSeverity,
    rounds: z.array(DisagreementRound).max(3).optional(),
    status: DisagreementStatus.optional(),
    ...AuthorProject,
  })
  .strict();

const HandoffCreate = z
  .object({
    from: z.string().min(1),
    summary: z.string().min(1),
    what_failed: z.string().nullable().optional(),
    lesson: z.string().nullable().optional(),
    open_questions: z.array(z.string()),
    suggested_next: z.string().nullable().optional(),
    confidence_drift: z.number().min(-1).max(1),
    ...AuthorProject,
  })
  .strict();

const ReviewNote = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  severity: NoteSeverity,
  category: NoteCategory,
  comment: z.string().min(1),
});

const ReviewCreate = z
  .object({
    target_commit: z
      .string()
      .regex(/^[0-9a-f]{7,40}$/, "target_commit must be a git sha"),
    target_plan: ArtifactId.optional(),
    reviewer: z.string().min(1),
    verdict: ReviewVerdict,
    notes: z.array(ReviewNote),
    cites: z.array(ArtifactId).optional(),
    ...AuthorProject,
  })
  .strict();

const RiskFlagCreate = z
  .object({
    target: z.string().min(1),
    severity: Severity,
    category: RiskCategory,
    description: z.string().min(1),
    mitigation: z.string().min(1),
    ...AuthorProject,
  })
  .strict();

// --- JSON schemas advertised on tools/list ----------------------------------
//
// We spell these out inline rather than pulling in a zod->jsonschema
// converter: the set of fields is small enough that manual mirroring is
// tractable and the result is easier to review.

const PlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "goal",
    "approach",
    "files_touched",
    "assumptions",
    "confidence",
    "blast_radius",
    "author",
    "project",
  ],
  properties: {
    goal: { type: "string", minLength: 1 },
    approach: { type: "string", minLength: 1 },
    files_touched: { type: "array", items: { type: "string", minLength: 1 } },
    assumptions: { type: "array", items: { type: "string", minLength: 1 } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    blast_radius: { type: "string", enum: ["small", "medium", "large"] },
    estimated_tokens: { type: "integer", minimum: 0 },
    risk_flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "mitigation"],
        properties: {
          severity: {
            type: "string",
            enum: ["low", "medium", "high", "critical"],
          },
          mitigation: { type: "string", minLength: 1 },
        },
      },
    },
    status: {
      type: "string",
      enum: ["objection_window", "approved", "blocked", "superseded"],
    },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const ClaimJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "target",
    "agent",
    "exclusive",
    "ttl_seconds",
    "reason",
    "author",
    "project",
  ],
  properties: {
    target: { type: "string", minLength: 1 },
    agent: { type: "string", minLength: 1 },
    exclusive: { type: "boolean" },
    ttl_seconds: { type: "integer", exclusiveMinimum: 0 },
    reason: { type: "string", minLength: 1 },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const HypothesisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "statement",
    "evidence_for",
    "evidence_against",
    "confidence",
    "author",
    "project",
  ],
  properties: {
    statement: { type: "string", minLength: 1 },
    evidence_for: { type: "array", items: { type: "string" } },
    evidence_against: { type: "array", items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const ExperimentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "hypothesis_id",
    "method",
    "expected",
    "author",
    "project",
  ],
  properties: {
    hypothesis_id: { type: "string" },
    method: { type: "string", minLength: 1 },
    expected: { type: "string", minLength: 1 },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const ResultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "experiment_id",
    "observed",
    "surprised_me",
    "author",
    "project",
  ],
  properties: {
    experiment_id: { type: "string" },
    observed: { type: "string", minLength: 1 },
    surprised_me: { type: "boolean" },
    next: { type: "string", minLength: 1 },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const DecisionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "question",
    "options",
    "chosen",
    "rationale",
    "signed_by",
    "author",
    "project",
  ],
  properties: {
    question: { type: "string", minLength: 1 },
    options: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    chosen: { type: "string", minLength: 1 },
    rationale: { type: "string", minLength: 1 },
    signed_by: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    expires: { type: ["string", "null"] },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const QuestionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "blocking", "addressed_to", "author", "project"],
  properties: {
    text: { type: "string", minLength: 1 },
    blocking: { type: "boolean" },
    addressed_to: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
    },
    context: { type: "array", items: { type: "string" } },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const CommitmentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["what", "by_when", "to_whom", "author", "project"],
  properties: {
    what: { type: "string", minLength: 1 },
    by_when: { type: "string" },
    to_whom: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
    },
    status: { type: "string", enum: ["open", "met", "missed"] },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const DisagreementJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "target",
    "thesis_agent",
    "thesis",
    "antithesis_agent",
    "antithesis",
    "evidence",
    "severity",
    "author",
    "project",
  ],
  properties: {
    target: { type: "string", minLength: 1 },
    thesis_agent: { type: "string", minLength: 1 },
    thesis: { type: "string", minLength: 1 },
    antithesis_agent: { type: "string", minLength: 1 },
    antithesis: { type: "string", minLength: 1 },
    evidence: { type: "array", items: { type: "string" } },
    severity: {
      type: "string",
      enum: ["advisory", "blocks_merge", "blocks_action"],
    },
    rounds: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["agent", "reply", "at"],
        properties: {
          agent: { type: "string", minLength: 1 },
          reply: { type: "string", minLength: 1 },
          at: { type: "string" },
        },
      },
    },
    status: {
      type: "string",
      enum: ["open", "resolved", "escalated_to_human"],
    },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const HandoffJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "from",
    "summary",
    "open_questions",
    "confidence_drift",
    "author",
    "project",
  ],
  properties: {
    from: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
    what_failed: { type: ["string", "null"] },
    lesson: { type: ["string", "null"] },
    open_questions: { type: "array", items: { type: "string" } },
    suggested_next: { type: ["string", "null"] },
    confidence_drift: { type: "number", minimum: -1, maximum: 1 },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const ReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "target_commit",
    "reviewer",
    "verdict",
    "notes",
    "author",
    "project",
  ],
  properties: {
    target_commit: { type: "string", pattern: "^[0-9a-f]{7,40}$" },
    target_plan: { type: "string" },
    reviewer: { type: "string", minLength: 1 },
    verdict: {
      type: "string",
      enum: ["approve", "request_changes", "block"],
    },
    notes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "line", "severity", "category", "comment"],
        properties: {
          file: { type: "string", minLength: 1 },
          line: { type: "integer", exclusiveMinimum: 0 },
          severity: {
            type: "string",
            enum: ["must_fix", "should_fix", "nit"],
          },
          category: {
            type: "string",
            enum: ["security", "race", "coverage", "style", "logic"],
          },
          comment: { type: "string", minLength: 1 },
        },
      },
    },
    cites: { type: "array", items: { type: "string" } },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

const RiskFlagJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "target",
    "severity",
    "category",
    "description",
    "mitigation",
    "author",
    "project",
  ],
  properties: {
    target: { type: "string", minLength: 1 },
    severity: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
    },
    category: {
      type: "string",
      enum: ["scalability", "security", "debt", "migration"],
    },
    description: { type: "string", minLength: 1 },
    mitigation: { type: "string", minLength: 1 },
    author: { type: "string", minLength: 1 },
    project: { type: "string", minLength: 1 },
  },
} as const;

// --- Builders ----------------------------------------------------------------

type Builder<T> = (id: string, args: T) => Artifact;

const buildPlan: Builder<z.infer<typeof PlanCreate>> = (id, args) =>
  createPlan({
    id,
    author: args.author,
    project: args.project,
    goal: args.goal,
    approach: args.approach,
    files_touched: args.files_touched,
    assumptions: args.assumptions,
    confidence: args.confidence,
    blast_radius: args.blast_radius,
    estimated_tokens: args.estimated_tokens ?? 0,
    risk_flags: args.risk_flags ?? [],
    status: args.status ?? "objection_window",
  });

const buildClaim: Builder<z.infer<typeof ClaimCreate>> = (id, args) =>
  createClaim({
    id,
    author: args.author,
    project: args.project,
    target: args.target,
    agent: args.agent,
    exclusive: args.exclusive,
    ttl_seconds: args.ttl_seconds,
    reason: args.reason,
  });

const buildHypothesis: Builder<z.infer<typeof HypothesisCreate>> = (id, args) =>
  createHypothesis({
    id,
    author: args.author,
    project: args.project,
    statement: args.statement,
    evidence_for: args.evidence_for,
    evidence_against: args.evidence_against,
    confidence: args.confidence,
  });

const buildExperiment: Builder<z.infer<typeof ExperimentCreate>> = (id, args) =>
  createExperiment({
    id,
    author: args.author,
    project: args.project,
    hypothesis_id: args.hypothesis_id,
    method: args.method,
    expected: args.expected,
  });

const buildResult: Builder<z.infer<typeof ResultCreate>> = (id, args) =>
  createResult({
    id,
    author: args.author,
    project: args.project,
    experiment_id: args.experiment_id,
    observed: args.observed,
    surprised_me: args.surprised_me,
    // The Result schema requires `next`; we default to a short placeholder
    // when the caller has nothing to suggest, preserving the "every result
    // points somewhere" invariant from docs/artifacts.md.
    next: args.next ?? "unspecified",
  });

const buildDecision: Builder<z.infer<typeof DecisionCreate>> = (id, args) =>
  createDecision({
    id,
    author: args.author,
    project: args.project,
    question: args.question,
    options: args.options,
    chosen: args.chosen,
    rationale: args.rationale,
    signed_by: args.signed_by,
    expires: args.expires ?? null,
  });

const buildQuestion: Builder<z.infer<typeof QuestionCreate>> = (id, args) =>
  createQuestion({
    id,
    author: args.author,
    project: args.project,
    text: args.text,
    blocking: args.blocking,
    addressed_to: args.addressed_to,
    context: args.context ?? [],
  });

const buildCommitment: Builder<z.infer<typeof CommitmentCreate>> = (id, args) =>
  createCommitment({
    id,
    author: args.author,
    project: args.project,
    what: args.what,
    by_when: args.by_when,
    to_whom: args.to_whom,
    status: args.status ?? "open",
  });

const buildDisagreement: Builder<z.infer<typeof DisagreementCreate>> = (
  id,
  args,
) =>
  createDisagreement({
    id,
    author: args.author,
    project: args.project,
    target: args.target,
    thesis_agent: args.thesis_agent,
    thesis: args.thesis,
    antithesis_agent: args.antithesis_agent,
    antithesis: args.antithesis,
    evidence: args.evidence,
    severity: args.severity,
    rounds: args.rounds ?? [],
    status: args.status ?? "open",
  });

const buildHandoff: Builder<z.infer<typeof HandoffCreate>> = (id, args) =>
  createHandoff({
    id,
    author: args.author,
    project: args.project,
    from: args.from,
    summary: args.summary,
    what_failed: args.what_failed ?? null,
    lesson: args.lesson ?? null,
    open_questions: args.open_questions,
    suggested_next: args.suggested_next ?? null,
    confidence_drift: args.confidence_drift,
  });

const buildReview: Builder<z.infer<typeof ReviewCreate>> = (id, args) =>
  createReview({
    id,
    author: args.author,
    project: args.project,
    target_commit: args.target_commit,
    // The Review schema requires `target_plan` (non-nullable). If the caller
    // doesn't bind the review to a Plan, we fall back to the artifact's own
    // id — the field is still a valid ArtifactId and the review is self-
    // referential, which is enough to satisfy the schema at this layer.
    target_plan: args.target_plan ?? id,
    reviewer: args.reviewer,
    verdict: args.verdict,
    notes: args.notes,
    cites: args.cites ?? [],
  });

const buildRiskFlag: Builder<z.infer<typeof RiskFlagCreate>> = (id, args) =>
  createRiskFlag({
    id,
    author: args.author,
    project: args.project,
    target: args.target,
    severity: args.severity,
    category: args.category,
    description: args.description,
    mitigation: args.mitigation,
  });

// --- Assemble the 12 tool definitions ---------------------------------------

interface CreateSpec<S extends z.ZodType<{ author: string }>> {
  name: string;
  type: ArtifactType;
  description: string;
  schema: S;
  jsonSchema: Record<string, unknown>;
  build: Builder<z.infer<S>>;
}

// Minimum shape that every create-tool schema must infer to: `author` is
// used here for id generation, everything else is routed through the
// type-specific `build` function. Declaring it keeps `args.author` typed
// as `string` inside the generic handler body.
type CreateArgsBase = { author: string };

function specToToolDef<S extends z.ZodType<CreateArgsBase>>(
  spec: CreateSpec<S>,
): ToolDef {
  // The handler body is generic over S, but we widen the returned ToolDef to
  // ToolDef<ZodTypeAny> so `CREATE_TOOLS: ToolDef[]` below type-checks without
  // per-spec invariance pain. At runtime the stored `inputSchema` still
  // re-validates args inside `server.ts` via safeParse — the widening is
  // purely a type convenience.
  const def: ToolDef<S> = {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.schema,
    jsonSchema: spec.jsonSchema,
    handler: async (args, ctx) => {
      const id = generateId(spec.type, args.author);
      let artifact: Artifact;
      try {
        artifact = spec.build(id, args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to construct ${spec.type}: ${msg}`,
            },
          ],
        };
      }
      try {
        await ctx.store.write(artifact);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Store.write failed for ${artifact.id}: ${msg}`,
            },
          ],
        };
      }
      return textResult({ id: artifact.id, type: artifact.type });
    },
  };
  return def as unknown as ToolDef;
}

/**
 * All 12 create tools. Exported as a flat array so `server.ts` can merge
 * them with the read/list/search tools without another layer of indirection.
 */
export const CREATE_TOOLS: ToolDef[] = [
  specToToolDef({
    name: "plan.create",
    type: "Plan",
    description: "Create a Plan artifact (declare intent before editing).",
    schema: PlanCreate,
    jsonSchema: PlanJsonSchema,
    build: buildPlan,
  }),
  specToToolDef({
    name: "claim.create",
    type: "Claim",
    description: "Create a Claim artifact (exclusive lock on target).",
    schema: ClaimCreate,
    jsonSchema: ClaimJsonSchema,
    build: buildClaim,
  }),
  specToToolDef({
    name: "hypothesis.create",
    type: "Hypothesis",
    description: "Create a Hypothesis artifact (express uncertainty).",
    schema: HypothesisCreate,
    jsonSchema: HypothesisJsonSchema,
    build: buildHypothesis,
  }),
  specToToolDef({
    name: "experiment.create",
    type: "Experiment",
    description: "Create an Experiment artifact (test a hypothesis).",
    schema: ExperimentCreate,
    jsonSchema: ExperimentJsonSchema,
    build: buildExperiment,
  }),
  specToToolDef({
    name: "result.create",
    type: "Result",
    description: "Create a Result artifact (report on an experiment).",
    schema: ResultCreate,
    jsonSchema: ResultJsonSchema,
    build: buildResult,
  }),
  specToToolDef({
    name: "decision.create",
    type: "Decision",
    description: "Create a Decision artifact (co-signed choice).",
    schema: DecisionCreate,
    jsonSchema: DecisionJsonSchema,
    build: buildDecision,
  }),
  specToToolDef({
    name: "question.create",
    type: "Question",
    description: "Create a Question artifact (blocking inquiry).",
    schema: QuestionCreate,
    jsonSchema: QuestionJsonSchema,
    build: buildQuestion,
  }),
  specToToolDef({
    name: "commitment.create",
    type: "Commitment",
    description: "Create a Commitment artifact ('I will do X by Y').",
    schema: CommitmentCreate,
    jsonSchema: CommitmentJsonSchema,
    build: buildCommitment,
  }),
  specToToolDef({
    name: "disagreement.create",
    type: "Disagreement",
    description: "Create a Disagreement artifact (structured debate).",
    schema: DisagreementCreate,
    jsonSchema: DisagreementJsonSchema,
    build: buildDisagreement,
  }),
  specToToolDef({
    name: "handoff.create",
    type: "Handoff",
    description: "Create a Handoff artifact (end-of-turn state package).",
    schema: HandoffCreate,
    jsonSchema: HandoffJsonSchema,
    build: buildHandoff,
  }),
  specToToolDef({
    name: "review.create",
    type: "Review",
    description: "Create a Review artifact (peer merge gate).",
    schema: ReviewCreate,
    jsonSchema: ReviewJsonSchema,
    build: buildReview,
  }),
  specToToolDef({
    name: "risk_flag.create",
    type: "RiskFlag",
    description: "Create a RiskFlag artifact (tracked concern).",
    schema: RiskFlagCreate,
    jsonSchema: RiskFlagJsonSchema,
    build: buildRiskFlag,
  }),
];
