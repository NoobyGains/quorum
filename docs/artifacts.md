# Artifacts — the 12 types

All coordination happens through typed JSON artifacts. Each artifact is:

- Stored as a JSON blob in git under `refs/coord/<type>/<id>`
- Indexed in SQLite for fast queries
- Immutable once created (updates publish a new artifact that references the previous via `supersedes`)
- Signed by its author (and, for some types, co-signers)

---

## Common fields

Every artifact has:

```jsonc
{
  "id": "pln_9c1",            // type-prefix + short hash
  "type": "Plan",
  "author": "claude",         // or "codex", "claude-w08", "human:david"
  "created": "2026-04-16T14:32:18Z",
  "project": "user-api",
  "version": 1,
  "supersedes": null,         // id of previous version, if any
  "signatures": [             // Ed25519 signatures
    { "signer": "claude", "sig": "..." }
  ]
}
```

---

## 1. Plan

**Purpose:** declare intent before editing code. Gate for "intent-before-action."

```jsonc
{
  "type": "Plan",
  "goal": "Rate-limit /api/users to 100 req/min per IP",
  "approach": "In-memory LRU sliding window",
  "files_touched": ["src/middleware/rateLimit.ts", "src/routes/users.ts"],
  "assumptions": ["<=2 nodes, session affinity active"],
  "confidence": 0.91,
  "blast_radius": "small" | "medium" | "large",
  "estimated_tokens": 12000,
  "risk_flags": [{ "severity": "low", "mitigation": "..." }],
  "status": "objection_window" | "approved" | "blocked" | "superseded"
}
```

## 2. Claim

**Purpose:** exclusive lock on an issue, feature, or file pattern. Prevents duplicate work.

```jsonc
{
  "type": "Claim",
  "target": "gh-issue-47" | "file:src/auth/**",
  "agent": "claude",
  "exclusive": true,
  "ttl_seconds": 3600,
  "reason": "starting rate-limit work"
}
```

First-writer-wins via SQLite transaction. Second claim returns `{ error: "claimed_by", agent: "codex" }`.

## 3. Hypothesis

**Purpose:** express uncertainty. "I think X because Y."

```jsonc
{
  "type": "Hypothesis",
  "statement": "The 500s on /users are from the rate-limit bypass path",
  "evidence_for": ["logs from 14:02:17 show ...", "related issue #38"],
  "evidence_against": [],
  "confidence": 0.7
}
```

## 4. Experiment

**Purpose:** plan to test a hypothesis.

```jsonc
{
  "type": "Experiment",
  "hypothesis_id": "hyp_7c",
  "method": "Hit /users with 150 req/sec for 30s, measure 500s",
  "expected": "≤5% 500s if hypothesis is correct"
}
```

## 5. Result

**Purpose:** what happened when you ran the experiment.

```jsonc
{
  "type": "Result",
  "experiment_id": "exp_3f",
  "observed": "22% 500s, concentrated on expired-token path",
  "surprised_me": true,
  "next": "new Hypothesis: token cache eviction is racy"
}
```

## 6. Decision

**Purpose:** record what was chosen and why. Bindings future behavior. Co-signed.

```jsonc
{
  "type": "Decision",
  "question": "Which cache/session backend for v2?",
  "options": ["Redis", "DynamoDB", "in-memory+sticky"],
  "chosen": "DynamoDB",
  "rationale": "Eliminates Redis as per 2026-Q3 cost initiative",
  "signed_by": ["claude", "codex", "human:david"],
  "expires": null
}
```

Decisions are queryable and citable — a `Plan` can reject a `Disagreement` by citing a relevant `Decision`.

## 7. Question

**Purpose:** blocking inquiry directed to another agent or human.

```jsonc
{
  "type": "Question",
  "text": "Should issue #144 be treated as a bug or intended behavior?",
  "blocking": true,
  "addressed_to": ["codex", "human:david"],
  "context": ["rev_3f", "pln_9c2"]
}
```

## 8. Commitment

**Purpose:** "I will do X by Y." Tracked, measured against.

```jsonc
{
  "type": "Commitment",
  "what": "Ship fix for issue #47",
  "by_when": "2026-04-16T18:00Z",
  "to_whom": ["codex", "human:david"],
  "status": "open" | "met" | "missed"
}
```

## 9. Disagreement

**Purpose:** structured debate. 3-round cap.

```jsonc
{
  "type": "Disagreement",
  "target": "pln_9c1",
  "thesis_agent": "claude",
  "thesis": "Use Redis for rate limiting",
  "antithesis_agent": "codex",
  "antithesis": "Redis conflicts with dcs_4f2 (Redis elimination)",
  "evidence": ["dcs_4f2", "logs/..."],
  "severity": "blocks_merge",
  "rounds": [ { /* replies */ } ],
  "status": "open" | "resolved" | "escalated_to_human"
}
```

## 10. Handoff

**Purpose:** end-of-turn state package. Other agent's next turn starts here.

```jsonc
{
  "type": "Handoff",
  "from": "claude",
  "summary": "Shipped #47. Original Redis plan blocked — resolved in 1 round.",
  "what_failed": "Initial plan missed Redis-elimination decision",
  "lesson": "Query refs/coord/decisions/ before infra choices",
  "open_questions": [],
  "suggested_next": "#48 — similar endpoint needs same treatment",
  "confidence_drift": -0.02
}
```

## 11. Review

**Purpose:** merge gate. Signed by peer of *other vendor*.

```jsonc
{
  "type": "Review",
  "target_commit": "c81fa03",
  "target_plan": "pln_9c2",
  "reviewer": "codex",                  // must be cross-vendor of author
  "verdict": "approve" | "request_changes" | "block",
  "notes": [
    { "file": "auth.ts", "line": 47,
      "severity": "must_fix" | "should_fix" | "nit",
      "category": "security" | "race" | "coverage" | "style" | "logic",
      "comment": "user_id flows unescaped into SQL..." }
  ],
  "cites": ["dcs_4f2"]
}
```

## 12. RiskFlag

**Purpose:** surface concerns that don't block now but should be tracked.

```jsonc
{
  "type": "RiskFlag",
  "target": "pln_9c2" | "commit:c81fa03",
  "severity": "low" | "medium" | "high" | "critical",
  "category": "scalability" | "security" | "debt" | "migration",
  "description": "In-memory LRU breaks at >2 nodes without sticky sessions",
  "mitigation": "Revisit at 4+ nodes; track in issue #99"
}
```

---

## Campaign (M5 only)

Parent container for fleet mode. Defined in [fleet-mode.md](fleet-mode.md).

```jsonc
{
  "type": "Campaign",
  "name": "3d-bugbash",
  "deadline": "2026-04-19T18:00Z",
  "issue_filter": { "label": "bug" },
  "budget_usd": 400,
  "budget_tokens": 2000000,
  "quality_floor": "no_test_regressions" | "dual-review",
  "fleet_size": { "claude_workers": 8, "codex_workers": 8, "reviewers": 4 }
}
```

---

## Finding (M5 only)

Insight that affects many issues; broadcast so the planner can re-cluster.

```jsonc
{
  "type": "Finding",
  "insight": "Issues #47, #89, #114, #203 share root cause: unescaped user_id in legacy query builder",
  "affects_issues": [47, 89, 114, 203],
  "one_fix_closes_all": true,
  "proposed_by": "codex-w07"
}
```

---

## Schema validation

All artifacts are validated at write-time via [Zod](https://zod.dev/) schemas in `packages/artifacts/`. Invalid writes are rejected before they hit the git store.

Schema evolution: bump `version` field; write a migration in `packages/artifacts/migrations/`. Old artifacts remain readable (they're immutable JSON).
