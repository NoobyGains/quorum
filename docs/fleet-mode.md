# Fleet Mode

Quorum's answer to *"I have 300 issues and 3 days."*

Fleet mode extends two-peer coordination into a 20+ worker bug-bash with isolated worktrees, cross-vendor review, and a merge conductor gating `main`.

---

## New primitives on top of the 7-layer core

| Primitive | Role |
|---|---|
| **Campaign** | Parent artifact. Name, deadline, issue filter, budget, quality floor. One dashboard, one kill-switch. |
| **Planner** | Meta-agent (Claude or Codex at root). Ingests backlog → scores complexity → clusters duplicates → builds dep-DAG → routes. |
| **Worker pool** | Headless sub-agents in isolated git worktrees (`.worktrees/w-*`). Each claims one issue. |
| **Reviewer pool** | Dedicated sub-agents whose only job is review. Cross-vendor from authors by default. |
| **Merge Conductor** | Singleton. Gates `main`. Sequences merges. Applies backpressure when CI is saturated. |
| **Finding broadcast** | When a worker discovers shared root cause, `Finding` fans out → planner re-clusters. |
| **Kill-switch** | One command (`/campaign kill`) pauses all workers. |
| **Cost ceiling** | Hard stop at $X or N tokens. |

---

## New MCP tools

```
campaign.start(name, deadline, issue_filter, budget, quality_floor)
campaign.status(id)
campaign.pause(id)
campaign.kill(id)

fleet.spawn(size, backend, role)
  // backend:  "claude" | "codex"
  // role:     "worker"   | "reviewer" | "planner"
  // forks N headless processes, each with its own worktree + MCP config

issue.triage(issues)              // complexity, cluster, dep graph
issue.assign_next(agent)          // planner picks best-next for this worker

finding.broadcast(insight, affects_issues)

merge.conduct(pr)                 // orchestrated merge with backpressure

dashboard.campaign_view(id)       // live grid URL
```

---

## Worker spawn — concrete (Windows)

Each headless worker runs in its own git worktree:

```bash
git worktree add .\.worktrees\w-012 -b fix/issue-47

# Claude headless:
claude -p "work on issue #47; follow quorum protocol" \
       --cwd .\.worktrees\w-012 &

# Codex headless:
codex exec --cwd .\.worktrees\w-012 "work on issue #47 ..." &
```

Each sub-agent inherits the `quorum` MCP config → auto-registers with a synthetic identity (`claude-w012`, `codex-w012`) → all coordination flows through the central SQLite store at `~/.quorum/<hash>/`.

**The root Claude/Codex window becomes the control tower.** No 20 terminal windows flying around; the fleet is headless.

---

## Reviewer pool — cross-vendor by default

When a worker publishes `review.request`:

1. Merge Conductor asks the Reviewer Pool for a free reviewer
2. Pool selects a reviewer of *the other vendor* from the author
3. Reviewer pulls the branch, runs tests, reads the diff, checks Plan + Decisions + Findings
4. Publishes structured `Review` artifact
5. If `approve` → merge gate cleared
6. If `request_changes` → author amends; targeted re-review (not full re-review)

Reviewers don't need huge context — just Plan + diff + relevant Decisions. ~5k tokens per review, not 50k.

**Calibration feedback:** reviewer outcomes (did they approve a bug, did they block something correct?) feed the calibration ledger. High-signal reviewers' verdicts carry more weight on close calls.

---

## Merge Conductor — sequencing + backpressure

Singleton process. Gates `main`. Logic:

```
incoming: approved PR from worker
  │
  ├─► semantic conflict with in-flight PR? ──yes──► hold
  │                                           no
  │                                           │
  ├─► CI pool saturated (>N in flight)? ─yes──► queue
  │                                       no
  │                                       │
  ├─► test regression? ──yes──► refuse (mark plan abandoned)
  │                          no
  │                          │
  └─► merge, close issue, update calibration ledger
```

**Backpressure**: if CI is saturated, Conductor sends `fleet.pause_spawns` signal. Workers finish in-flight but no new ones spawn until CI catches up. Keeps the system from collapsing under its own throughput.

---

## Finding broadcast

When worker-7 discovers "issues #47, #89, #114 share root cause X":

```jsonc
finding.broadcast {
  insight: "Unescaped user_id in legacy query builder",
  affects_issues: [47, 89, 114, 203],
  one_fix_closes_all: true,
  proposed_by: "codex-w07"
}
```

Planner consumes the event, rescinds Claims on the affected issues, reassigns the remaining workers to other work. Net result: **work that would have been duplicated is eliminated**.

---

## Quality floor modes (per Campaign)

- `no_test_regressions` (default) — Conductor refuses any merge that fails the test suite
- `dual-review` — every PR needs both Claude-sig and Codex-sig (not just cross-vendor; *both*)
- `dual-review-paths: ["src/auth/**"]` — dual-review only on listed paths
- `block-on-riskflag-high` — merges are held if any open `RiskFlag` has severity ≥ high on touched files

---

## Cost ceiling + kill-switch

```jsonc
campaign.start {
  name: "3d-bugbash",
  budget_usd: 400,
  budget_tokens: 2000000,
  ...
}
```

- Workers see budget burn-down in real time
- At 80% budget: Conductor stops spawning new workers, lets in-flight finish
- At 100%: hard kill
- `/campaign kill <id>` — any window, any time, stops the world

---

## Simulation — 3-day bug bash

### `t+0` — initiate

```
You: /campaign start 3d-bugbash budget=$400 quality_floor=no_test_regressions
You: "Scan GH for bug-labeled issues, triage, spawn fleet"
```

### `t+30s` — Planner triages

```
312 issues ingested → 287 after dedup
Scored: S=140, M=98, L=38, XL=11
Detected: 8 clusters sharing root causes
Dep-DAG: 23 issues blocked by others
Routed: Codex → parsers/Python, Claude → React/TS
```

### `t+2m` — Fleet spawned

```
fleet.spawn(size=8, backend="claude", role="worker")
fleet.spawn(size=8, backend="codex",  role="worker")
fleet.spawn(size=4, cross-vendor,     role="reviewer")
→ 20 git worktrees created, 20 headless agents running
```

### `t+12m` — First Finding

```
codex-w07 broadcasts: "issues #47, #89, #114, #203 share root cause X"
Planner: rescinds claims on #89,#114,#203 → 3 workers freed for other work
```

### `t+1h` — Conductor load

```
✓ 11 merged  │  4 in-review  │  3 queued (CI saturated)
⚠ backpressure: pausing new spawns for 90s
1 Disagreement opened, auto-resolved (1 round)
```

### `t+4h` — Dashboard

```
Claimed: 94/287     Merged: 38     In-review: 7
Abandoned: 6 (test regressions)
Cost: $68/$400      Calibration: claude 0.88, codex 0.91
```

### `t+18h` — Human pinged once

```
Push notification:
  "Workers w-04, w-11 disagree on whether #144 is a bug.
   Thesis: bug (regression from #98). Antithesis: intended (per dcs_3a1).
   Pick [A/B]:"

You tap B. Decision signed. 2 seconds.
```

### `t+48h` — Auto-downscale

```
Merged: 189     Open: 31 XL-complexity (planner holding back)
Fleet auto-downscaled to 6 workers (backlog thinning)
```

### `t+72h` — Final

```
Closed: 218     Deferred: 34 (documented)     Abandoned: 35 (bad repros)
Cost: $287 of $400 budget
Human-attention wall-clock: ~11 minutes total across 3 days
```

---

## Why this throughput is real

1. **Worktree-per-worker** → no lock contention on the working tree
2. **Planner + Findings** → no duplicate work; insights fan out
3. **Merge Conductor** → sequenced merges avoid semantic conflicts
4. **Cross-vendor review** → genuine second pair of eyes, not rubber-stamp
5. **Quality floor + kill-switch** → a runaway agent can't tank the repo

The real constraint at 20 parallel workers is not dollars but **rate limits on your agent subscriptions**. The Conductor's backpressure handles it gracefully; you just lose some wall-clock, not work.

See [cost-and-throttling.md](cost-and-throttling.md) for details.
