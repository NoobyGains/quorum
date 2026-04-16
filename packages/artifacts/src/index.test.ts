import { describe, it, expect } from "vitest";

import {
  ARTIFACT_PACKAGE_VERSION,
  ARTIFACT_TYPES,
  ArtifactSchema,
  isArtifact,
} from "./index.js";

// Minimal common fields shared across every fixture below. Centralising
// these keeps per-type fixtures small and clearly type-focused.
const common = {
  author: "claude",
  created: "2026-04-16T14:32:18Z",
  project: "user-api",
  version: 1,
  supersedes: null,
  signatures: [] as { signer: string; sig: string }[],
};

// One minimal valid instance per type, using the example values from
// docs/artifacts.md wherever possible.
const fixtures: Record<string, unknown> = {
  Plan: {
    ...common,
    id: "pln_9c1",
    type: "Plan",
    goal: "Rate-limit /api/users to 100 req/min per IP",
    approach: "In-memory LRU sliding window",
    files_touched: ["src/middleware/rateLimit.ts"],
    assumptions: ["<=2 nodes, session affinity active"],
    confidence: 0.91,
    blast_radius: "small",
    estimated_tokens: 12000,
    risk_flags: [{ severity: "low", mitigation: "monitor" }],
    status: "objection_window",
  },
  Claim: {
    ...common,
    id: "clm_47",
    type: "Claim",
    target: "gh-issue-47",
    agent: "claude",
    exclusive: true,
    ttl_seconds: 3600,
    reason: "starting rate-limit work",
  },
  Hypothesis: {
    ...common,
    id: "hyp_7c",
    type: "Hypothesis",
    statement: "The 500s on /users are from the rate-limit bypass path",
    evidence_for: ["logs from 14:02:17"],
    evidence_against: [],
    confidence: 0.7,
  },
  Experiment: {
    ...common,
    id: "exp_3f",
    type: "Experiment",
    hypothesis_id: "hyp_7c",
    method: "Hit /users with 150 req/sec for 30s, measure 500s",
    expected: "<=5% 500s if hypothesis is correct",
  },
  Result: {
    ...common,
    id: "res_01",
    type: "Result",
    experiment_id: "exp_3f",
    observed: "22% 500s, concentrated on expired-token path",
    surprised_me: true,
    next: "new Hypothesis: token cache eviction is racy",
  },
  Decision: {
    ...common,
    id: "dcs_4f2",
    type: "Decision",
    question: "Which cache/session backend for v2?",
    options: ["Redis", "DynamoDB", "in-memory+sticky"],
    chosen: "DynamoDB",
    rationale: "Eliminates Redis as per 2026-Q3 cost initiative",
    signed_by: ["claude", "codex", "human:david"],
    expires: null,
  },
  Question: {
    ...common,
    id: "qst_1a",
    type: "Question",
    text: "Should issue #144 be treated as a bug or intended behavior?",
    blocking: true,
    addressed_to: ["codex", "human:david"],
    context: ["rev_3f", "pln_9c2"],
  },
  Commitment: {
    ...common,
    id: "cmt_2b",
    type: "Commitment",
    what: "Ship fix for issue #47",
    by_when: "2026-04-16T18:00:00Z",
    to_whom: ["codex", "human:david"],
    status: "open",
  },
  Disagreement: {
    ...common,
    id: "dsg_01",
    type: "Disagreement",
    target: "pln_9c1",
    thesis_agent: "claude",
    thesis: "Use Redis for rate limiting",
    antithesis_agent: "codex",
    antithesis: "Redis conflicts with dcs_4f2 (Redis elimination)",
    evidence: ["dcs_4f2"],
    severity: "blocks_merge",
    rounds: [],
    status: "open",
  },
  Handoff: {
    ...common,
    id: "hnd_01",
    type: "Handoff",
    from: "claude",
    summary: "Shipped #47. Original Redis plan blocked.",
    what_failed: "Initial plan missed Redis-elimination decision",
    lesson: "Query refs/coord/decisions/ before infra choices",
    open_questions: [],
    suggested_next: "#48 — similar endpoint needs same treatment",
    confidence_drift: -0.02,
  },
  Review: {
    ...common,
    id: "rev_2a",
    type: "Review",
    target_commit: "c81fa03",
    target_plan: "pln_9c2",
    reviewer: "codex",
    verdict: "approve",
    notes: [
      {
        file: "auth.ts",
        line: 47,
        severity: "must_fix",
        category: "security",
        comment: "user_id flows unescaped into SQL",
      },
    ],
    cites: ["dcs_4f2"],
  },
  RiskFlag: {
    ...common,
    id: "rsk_01",
    type: "RiskFlag",
    target: "pln_9c2",
    severity: "medium",
    category: "scalability",
    description: "In-memory LRU breaks at >2 nodes without sticky sessions",
    mitigation: "Revisit at 4+ nodes; track in issue #99",
  },
};

describe("@quorum/artifacts", () => {
  it("exports the expected package version", () => {
    expect(ARTIFACT_PACKAGE_VERSION).toBe("0.0.1");
  });

  it("lists all 12 artifact types", () => {
    expect(ARTIFACT_TYPES).toHaveLength(12);
    expect(new Set(ARTIFACT_TYPES).size).toBe(12);
  });
});

describe("ArtifactSchema (discriminated union)", () => {
  for (const type of ARTIFACT_TYPES) {
    it(`accepts a valid ${type}`, () => {
      const fx = fixtures[type];
      const parsed = ArtifactSchema.safeParse(fx);
      if (!parsed.success) {
        // Surface the zod error so CI output is actually debuggable.
        throw new Error(
          `${type} failed to parse: ${JSON.stringify(parsed.error.issues, null, 2)}`,
        );
      }
      expect(parsed.data.type).toBe(type);
    });
  }

  it("rejects objects with an unknown `type` discriminator", () => {
    const bogus = { ...common, id: "xxx_01", type: "Unknown" };
    expect(ArtifactSchema.safeParse(bogus).success).toBe(false);
    expect(isArtifact(bogus)).toBe(false);
  });

  it("rejects objects missing the `type` discriminator", () => {
    const { type: _omit, ...rest } = fixtures.Plan as { type: string };
    void _omit;
    expect(ArtifactSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects null / non-object inputs", () => {
    expect(ArtifactSchema.safeParse(null).success).toBe(false);
    expect(ArtifactSchema.safeParse("Plan").success).toBe(false);
    expect(ArtifactSchema.safeParse(42).success).toBe(false);
  });

  it("covers every ARTIFACT_TYPES entry with a fixture", () => {
    // Guard against future drift: if someone adds a type but forgets a
    // fixture, the loop above can't catch the missing key. This does.
    for (const t of ARTIFACT_TYPES) {
      expect(fixtures[t]).toBeDefined();
    }
  });
});
