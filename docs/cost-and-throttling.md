# Cost & Throttling

Honest accounting: how many tokens Quorum costs vs the naive "just let agents rip" baseline, and the knobs to tune it.

---

## The TL;DR

- **Solo-feature, two-peer mode:** ~50% token overhead
- **Fleet mode, 20 workers:** ~35% token overhead
- **On subscription plans (Claude Max + Codex Pro):** effectively $0 marginal; constraint is rate-limits, not dollars

In exchange, you get: bugs caught pre-merge, duplicate work eliminated, decisions auditable. The overhead is net-positive if you'd otherwise spend tokens debugging what slipped through.

---

## Where the tokens go

| Source | Typical cost | Triggered by |
|---|---|---|
| Plan publication (JSON artifact) | ~300–600 tokens | every task started |
| Objection check (read peer's Decisions) | ~500 tokens | every Plan |
| Cross-vendor code review | **~3–8k tokens** | every PR *(biggest item)* |
| Handoff (structured end-of-turn) | ~200–400 tokens | every turn |
| Inbox hook injection (presence + unread) | ~50–150 tokens | every user prompt |
| Disagreement round | ~1–2k tokens | per round (cap = 3) |
| Planner triage (fleet mode) | ~20–50k tokens | **once per campaign** (amortized) |
| Findings broadcast | ~500 tokens | but *saves* multiples of that |
| Calibration ledger | ~0 | passive storage |

---

## Rough bills

**Solo-feature, two-peer mode** (e.g., one issue, two agents):

| Mode | Tokens |
|---|---|
| Without Quorum | ~10–15k |
| With Quorum | ~15–22k (~50% overhead) |

Catches: race conditions, scope drift, decision violations. These cost 50–100k tokens to debug post-merge.

**Fleet mode, 3-day bug bash, 200 issues closed, 20 headless workers:**

| Source | Tokens |
|---|---|
| Raw work (200 × ~20k/task) | ~4M |
| Quorum overhead | ~1.5M (~37%) |
| Total | ~5.5M |

On Claude Max ($200/mo) + Codex Pro ($200/mo) subscriptions, the headless sub-agents inherit your plans — **$0 marginal** *if* you stay inside rate limits.

---

## Why Quorum is cheaper than you'd guess

1. **Typed artifacts are *smaller* than chat** — `Plan` is ~300 tokens of JSON; equivalent chat explanation is 800+.
2. **Reviewers don't need full repo context** — Plan + diff + relevant Decisions ≈ ~5k tokens, not 50k.
3. **Findings broadcast eliminates redundant work** — one finding often frees 3–5 workers from duplicate fixes. Net *saving*.
4. **Planner triage is amortized** — one 30k-token triage for 300 issues = 100 tokens/issue.
5. **Calibration tracking is passive** — logging outcomes, not generating.
6. **Objection windows run in parallel with action**, not before — lose seconds of wall-clock, not tokens.

---

## Tuning knobs (set on Campaign or project config)

```jsonc
{
  "review_depth": "summary",       // cheap: skim-review for low-risk paths
  // or "line"        // normal: full line-by-line
  // or "spot-check"  // cheapest: reviewer picks 3 random hunks

  "objection_window_seconds": 0,   // skip objection for low-risk tasks
  // or 10, 30                     // default 10

  "cross_vendor_required": true,   // saves ~30% if you trust same-vendor (not recommended)

  "planner_model":   "sonnet",     // biggest knob at scale
  "worker_model":    "sonnet",     // sonnet is usually enough for bugs
  "reviewer_model":  "haiku",      // haiku for style-review, sonnet for logic, opus for security
  "critical_model":  "opus",       // used for high-blast-radius Plans only

  "dual_review_paths": [           // dual-review only on sensitive paths
    "src/auth/**",
    "migrations/**",
    "billing/**"
  ],

  "finding_broadcast_threshold": 0.7,  // only broadcast high-confidence findings
}
```

### Recommended default profile

```jsonc
{
  "review_depth": "line",
  "objection_window_seconds": 10,
  "cross_vendor_required": true,
  "planner_model": "opus",         // amortized — OK to use best model once
  "worker_model": "sonnet",
  "reviewer_model": "sonnet",
  "critical_model": "opus",
  "dual_review_paths": ["src/auth/**", "migrations/**"]
}
```

Gives ~35% overhead. Good balance.

---

## Rate-limit behavior (the real constraint)

On subscription plans, dollars are a fixed rate; **rate limits** are the ceiling.

- Max plan: generous but not infinite request/token-per-minute limits
- Codex Pro: similar

At 20 parallel headless workers + 4 reviewers, you **will** hit rate limits during burst periods. Merge Conductor's backpressure handles this:

```
rate_limit_remaining < threshold
  └─► fleet.pause_spawns
         │
         └─► workers finish in-flight work
               │
               └─► rate limit refills
                     │
                     └─► fleet.resume_spawns
```

Expected impact: 20 workers become effectively 6–10 during bursts. Wall-clock for a 3-day bug bash stretches by ~20–40%, not 10×. No work is lost.

---

## `campaign.profile(hours)` — predicting spend before launch

Planned M5 tool. Given a campaign config + historical calibration data, returns:

```jsonc
{
  "estimated_tokens": 5_500_000,
  "estimated_usd_on_api": 187.50,       // if on API pricing
  "estimated_usd_on_subscription": 0,   // if inheriting subscriptions
  "estimated_wall_clock_hours": 72,
  "rate_limit_pressure": "medium",      // "low" | "medium" | "high"
  "recommended_adjustments": [
    "reduce fleet_size.codex_workers from 8 to 5 to stay under rate limits",
    "skip objection_window for complexity=S issues (saves ~5%)"
  ]
}
```

Lets you dial the campaign in *before* launch instead of discovering problems at t+4h.

---

## Minimal-cost mode (for solo developers)

If you're paying for API calls out-of-pocket and want the bare minimum:

```jsonc
{
  "review_depth": "spot-check",
  "objection_window_seconds": 0,
  "cross_vendor_required": false,
  "planner_model": "haiku",
  "worker_model": "haiku",
  "reviewer_model": "haiku",
  "critical_model": "sonnet",
  "dual_review_paths": []
}
```

Overhead drops to ~10–15%. You lose some safety but for simple repos with light workflows it's fine.

---

## Bottom line

Quorum's overhead is *predictable, configurable, and usually free on subscriptions*. The real limit at scale is rate-limit throughput, which the Merge Conductor handles without dropping work. Budget planning uses `campaign.profile()`, and kill-switches cap downside.

Don't think "is Quorum expensive?" — think "is coordinated throughput worth ~35% more tokens than uncoordinated chaos?" On any repo bigger than toy-scale, yes.
