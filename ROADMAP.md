# Roadmap

Quorum ships in six milestones. Each milestone is independently valuable — if we stop after M1, you already have something better than anything currently on the market.

---

## M0 — Foundation & Bootstrap

**Goal:** repo, CI, design docs, MCP stub. Nothing yet *does* coordination — we're laying the tracks.

- TypeScript monorepo (pnpm + turbo)
- Node 20+ CI matrix: Windows, macOS, Linux
- Full design docs (`docs/design.md`, `docs/artifacts.md`, `docs/protocols.md`)
- `npx quorum init` and `npx quorum doctor` CLI stubs
- MCP stdio server responds to `ping`

**Exit criteria:** CI green on three OSes; `npx quorum doctor` prints a green report.

---

## M1 — Core Protocol ⭐

**The MVP.** Everything below this line makes Quorum *useful*.

- All 12 artifact types: JSON schemas + git-backed store + SQLite index
- CRUD MCP tools: `plan.create`, `claim.create`, `handoff.create`, `review.create`, etc.
- **Intent-before-action** protocol: objection window logic
- **Merge-requires-review** gate: git hook + server-side enforcement
- Handoff protocol (end-of-turn state package)
- Rust watchdog daemon: file + git-ref watchers, event bus, subscription filters
- MCP push notifications (mid-turn) + UserPromptSubmit hook (between-turn)
- `quorum claim`, `quorum plan`, `quorum handoff` CLI commands
- First end-to-end: Claude writes a Plan → Codex objects → resolution → code → review → merge

**Exit criteria:** the [simulation in docs/design.md](docs/design.md) works for real between one live Claude and one live Codex.

---

## M2 — Disagreement & Human-Broker

**Close the loop.** What happens when agents can't agree.

- `Disagreement` state machine: thesis/antithesis/evidence/resolution (3-round cap)
- Resolution codes: `concede`, `concede_with_alternative`, `escalate`
- Human-broker channel: push notification (ntfy / webhook / Pushover) with structured question
- Reply ingestion → signed `Decision` artifact
- Intervention thresholds configurable per-project

**Exit criteria:** a demo where two agents disagree, escalate, a human replies from their phone, and the decision is binding.

---

## M3 — Calibration & Observability

**Make it learn.** Data from outcomes loops back into routing.

- Outcome tracking ledger (prediction → observation → calibration)
- Brier score per agent per task category
- Confidence gate enforcement (low-confidence + high-blast-radius ⇒ mandatory review)
- Local dashboard at `localhost:3847`: live coordination DAG
- Time-travel rewind slider (git log over `refs/coord/*`)
- Cost panel: tokens, rate-limit headroom, $ equivalent

**Exit criteria:** after a week of use, dashboard shows calibration drift and at least one agent-skill profile clearly above baseline.

---

## M4 — Specialization & Cost-Aware Routing

**Route by skill, not by whoever asks first.**

- Skill profile inference from outcome history (per language/framework/domain)
- `propose_owner(task)` tool recommending best claimant
- Token-budget awareness: each agent sees peer's remaining budget
- Cost-weighted task routing: cheap tasks → cheaper agent; expensive reasoning → agent with budget
- Rate-limit-aware spawning (Merge Conductor backpressure)

**Exit criteria:** on a mixed 20-issue workload, routed throughput beats random-assignment by ≥30%.

---

## M5 — Fleet Mode

**Bug bash at scale.** The "300 issues in 3 days" capability.

- `Campaign` artifact: parent container with deadline, budget, quality floor
- Planner role: ingest → score → cluster → dep-graph → route
- Headless worker spawn via `claude -p` / `codex exec` in isolated git worktrees
- Cross-vendor Reviewer Pool (specialized sub-agents)
- Merge Conductor: sequenced merges, CI backpressure, regression refusal
- `Finding` broadcast: insight fans out, planner re-clusters
- Kill-switch + cost ceiling (hard stop at $X or N tokens)
- Campaign dashboard: live grid of 300 issues × 20 workers

**Exit criteria:** a ≥100-issue campaign completes within budget with zero regressions landing in `main`.

---

## Post-M5 (ideas, unscoped)

- Support for Gemini, Qwen, other agent harnesses (they speak MCP too)
- Cross-machine mode (agents on different boxes via encrypted relay)
- "Replay mode": replay a campaign's coordination graph onto a new repo as a shakedown test
- Agent self-improvement: analyze own calibration drift, propose prompt changes
