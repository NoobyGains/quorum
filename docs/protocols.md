# Protocols

Artifacts alone don't coordinate — **protocols** do. Quorum defines four core protocols layered on the artifact store.

---

## 1. Intent-before-action

**Rule:** no code edit without a published, unchallenged `Plan`.

**Flow:**

```
agent.edit_file(...) attempt
        │
        ├─► is there an active Plan covering this file? ──no──► REJECT
        │                                               yes
        │                                                │
        ├─► is the Plan within objection window? ──yes──► WAIT
        │                                             no
        │                                              │
        └─► proceed
```

**Objection window** (default 10s):

- Triggered when a `Plan` is published
- Watchdog pushes `plan.published` event to peers whose `watch_set` intersects `Plan.files_touched`
- Peer can publish a `Disagreement` with `severity: blocks_merge` → Plan status → `blocked`
- If window closes without objection → Plan status → `approved`

**Configurable per Campaign:** `objection_window_seconds: 0 | 10 | 30`. Set to 0 for low-risk tasks to save wall-clock.

---

## 2. Merge-requires-review (the two-key gate)

**Rule:** no commit lands on `main` without a `Review { verdict: approve }` signed by a peer of the *other vendor*.

**Enforcement:** server-side git hook (`pre-receive`) checks `refs/coord/reviews/` for an approve on the HEAD commit of every push to `main`.

**Cross-vendor is the default** because same-vendor agents share training blind spots. A Claude sub-agent reviewing another Claude sub-agent catches fewer novel issues than a Codex reviewer would.

**Stricter modes (per Campaign / per path):**

- `quality_floor: "dual-review"` — require both a Claude-signature AND a Codex-signature
- `dual_review_paths: ["src/auth/**", "migrations/**"]` — dual-review only on listed paths

**Human override:** a human can sign `Review { verdict: approve, override: true }`. Logged as a `RiskFlag` with `severity: medium` ("merged without cross-vendor review").

---

## 3. Structured disagreement

**Rule:** when agents disagree, protocol is thesis → antithesis → each cites evidence. Max 3 rounds. Either concede or escalate.

**States:**

```
open ──round 1──► open ──round 2──► open ──round 3──► escalated
  │                │                  │                  │
  └────► resolved ─┴────► resolved ───┴────► resolved   human-broker
           │                  │                  │         │
        conceded          conceded          conceded    Decision
         (or)              (or)              (or)
       concede_with      concede_with      concede_with
       alternative       alternative       alternative
```

**Round structure:**

Each round, both sides may publish one reply citing evidence (other artifacts). After 3 rounds without resolution, the `Disagreement` escalates to the human-broker channel (see [design.md § Layer 6](design.md#layer-6--human-as-arbiter-not-bottleneck)).

**Resolution codes:**

- `conceded` — one side accepts the other's position as-is
- `concede_with_alternative` — proposes a third path acceptable to both
- `escalate_to_human` — unresolved after 3 rounds

---

## 4. Handoff protocol

**Rule:** at end-of-turn, agent publishes a `Handoff`. Other agent's next turn begins with `Handoff.summary` prepended to its context.

This replaces "scroll back through chat." State transfer is structured: what I did, what failed, open questions, suggested next steps.

**What makes it work:**

- Small (a few hundred tokens) — doesn't bloat context
- Structured — the receiving agent can extract `open_questions` directly
- Chained — each `Handoff` references the previous via `supersedes`; time-travel replay available via git log

---

## Simulation

### Scenario

Repo: `user-api`. Issue #47: "Add rate limiting to /api/users."

### `t+0s` — boot

```
[watchdog] claude.registered  { pid: 9104, window: "WT-1" }
[watchdog] codex.registered   { pid: 4782, window: "WT-2" }
[watchdog] presence_change    { online: ["claude", "codex"] }
```

Both agents' UserPromptSubmit hooks see:

> **[quorum] Peer online:** codex (since t+0s). 0 unread artifacts.

### `t+12s` — Claude claims and plans

```jsonc
claim.create { target: "gh-issue-47", agent: "claude", ttl: 3600 }
→ { ok: true, id: "clm_7a2" }

plan.create {
  id: "pln_9c1",
  approach: "Redis-backed sliding window",
  files_touched: ["src/middleware/rateLimit.ts"],
  assumptions: ["Redis available in prod"],
  confidence: 0.85
}
→ { objection_window_closes_at: "t+22s" }
```

### `t+14s` — Codex objects (cites a Decision)

```jsonc
decision.get "dcs_4f2"
→ { chosen: "DynamoDB", rationale: "eliminate Redis by Q3", signed_by: [...] }

disagreement.create {
  target: "pln_9c1",
  antithesis: "Redis conflicts with dcs_4f2",
  evidence: ["dcs_4f2"],
  severity: "blocks_merge"
}
→ { id: "dsg_3b0", pln_9c1.status: "blocked" }
```

### `t+16s` — Claude concedes with alternative

```jsonc
disagreement.reply "dsg_3b0" {
  from: "claude",
  position: "concede_with_alternative",
  alternative: "in-memory LRU + sticky sessions"
}
```

### `t+17s` — Codex accepts, disagreement resolves in 1 round

```jsonc
disagreement.resolve "dsg_3b0" { resolution: "adopted_alternative" }
```

### `t+31s` — Claude publishes revised plan, objection window passes silently

```jsonc
plan.supersede "pln_9c1" → "pln_9c2" { approach: "in-memory LRU", confidence: 0.91 }
```

### `t+42s → t+6m` — Claude implements, requests review

```jsonc
review.request { target_commit: "b4c7e21", reviewer: "codex" }
```

### `t+6m 10s` — Codex reviews, requests changes

Codex pulls the branch, runs tests locally, reads the diff.

```jsonc
review.create {
  target: "b4c7e21",
  verdict: "request_changes",
  notes: [
    { line: 34, severity: "must_fix",
      comment: "Race: concurrent requests can both pass the if-check" }
  ]
}
```

### `t+6m 30s` — Claude fixes, re-requests

```jsonc
review.create {
  target: "c81fa03",
  verdict: "approve",
  notes: [{ comment: "Race fixed with atomic compute(). LGTM." }]
}
→ merge_gate_cleared
```

Claude auto-merges. Closes issue.

### `t+9m 02s` — Handoffs + calibration update

```jsonc
handoff.create {
  from: "claude",
  summary: "Shipped #47. Redis plan blocked — resolved in 1 round.",
  lesson: "Query refs/coord/decisions/ before infra choices"
}
```

Calibration:

```
claude: predicted=0.85 for pln_9c1, outcome=blocked → -0.02 (overconfident on infra)
codex:  detected violation via decision-lookup → +0.05 on :governance specialization
```

**Total wall-clock: 9 minutes. Human interventions: 0. Rounds of debate: 1. Bugs caught pre-merge: 1 race condition.**

---

## What this catches that chat-based tools can't

1. **Bad plan dies at t+14s, not t+3h.** Redis-based implementation never got written.
2. **No chat happened.** Every exchange was typed and auditable.
3. **Debate terminated in one round** via evidence (a citable Decision).
4. **Merge gate caught a real race condition.**
5. **Human wasn't pinged.** System self-handled.
6. **Calibration moved.** Future infra plans from Claude will be weighted less confidently.
