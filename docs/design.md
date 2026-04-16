# Design — 7-Layer Architecture

> Replace "Claude and Codex can message each other" with "Claude and Codex share a typed, versioned, auditable mind with protocol-enforced intent declaration, peer review, and structured disagreement resolution."

---

## Reframe: stop thinking "chat." Start thinking "shared mind."

Every existing agent-coordination tool is a messaging service with extra flags. That's the wrong primitive. Two peer LLM agents don't need Slack — they need a **typed, versioned, append-only cognitive workspace** that both reason *into* and *from*.

Chat is what humans do because our bandwidth sucks. LLMs can do structured I/O. Use it.

---

## Layer 0 — Git as the coordination substrate

Everything is a commit on `refs/coord/*`. Free wins:

- **Atomicity** — commits are atomic; no half-written coordination state
- **History** — full audit trail of every decision, for free
- **Merge semantics** — two agents updating coordination state in parallel merges via git, not a custom lock server
- **Distributed consistency** — two machines could sync coordination state via `git push/pull` on `refs/coord/*` (post-M5)
- **No database to corrupt, no lock server to lose**

Working branches are real git branches. Coordination state is just another ref namespace.

```
refs/heads/main               ← production code
refs/heads/claude/issue-47    ← Claude's working branch
refs/heads/codex/issue-89     ← Codex's working branch
refs/coord/plans/pln_9c1      ← artifact: a published plan
refs/coord/reviews/rev_2      ← artifact: a signed review
refs/coord/decisions/dcs_4f2  ← artifact: an ADR
refs/coord/index              ← SQLite snapshot (queryable)
```

---

## Layer 1 — Typed artifact store (not messages)

A schema registry of **12 artifact types**, each stored as:

- A JSON blob in git under `refs/coord/<type>/<id>`
- Indexed in a per-project SQLite database for fast queries
- Merkle-chained (commit hashes link) for tamper-evidence

See [artifacts.md](artifacts.md) for the full schema of each type.

**There are no "messages."** Every communication is a typed artifact. Want to say "I think X"? Publish a `Hypothesis`. Want to propose a fix? Publish a `Plan`. This forces precision and makes everything queryable, diff-able, reasoning-trace-able.

---

## Layer 2 — Protocols layered on the artifact store

See [protocols.md](protocols.md) for full detail. Highlights:

- **Intent-before-action** — you can't edit code without first publishing a `Plan`. Peer gets a configurable objection window. Silence = proceed; objection = `Disagreement` opens.
- **Merge-requires-review** — cannot merge to `main` without a `Review { verdict: approve }` signed by a peer *of the other vendor*.
- **Structured debate** — `Disagreement` has thesis → antithesis → evidence. Max 3 rounds. Terminates or escalates to human.
- **Handoff protocol** — end of every turn, agent publishes a `Handoff`. Other agent's next turn begins with that as context.

---

## Layer 3 — Watchdog daemon

A persistent Rust binary per project, watching:

- Filesystem changes (`inotify` on Linux, `FSEvents` on macOS, `ReadDirectoryChangesW` on Windows)
- Git refs via `git-fsmonitor` protocol
- The SQLite artifact index

Publishes a typed event bus. Two delivery modes:

- **Mid-turn MCP push** (urgent) — "your Plan was blocked", "a peer pushed a commit touching your file"
- **Between-turn hook injection** (ambient) — UserPromptSubmit hook calls `quorum inbox --unread` and prepends to context

Without a watchdog, agents rely on polling. That's either laggy or wasteful. The daemon makes push the default.

---

## Layer 4 — Calibrated epistemics

Every artifact carries `confidence: 0–1` and `assumptions: [...]`.

The system logs predicted-vs-actual outcomes over time, computing **Brier scores** per agent per category:

- Predicted 0.9 confidence, outcome was correct → calibration maintained
- Predicted 0.9, outcome was wrong → overconfidence (-0.05 in this category)
- Predicted 0.5, always wrong → under-confident or genuinely uncertain domain

Uses it to:

- **Gate solo action** — confidence < 0.7 AND blast_radius > small ⇒ mandatory pre-review
- **Weight Decision signatures** — a better-calibrated agent's vote counts more on close calls
- **Surface to human** — "Claude is overconfident on database migrations this month"

Nobody else is building this. It's where the real signal lives.

---

## Layer 5 — Specialization routing

From accumulated outcome data, learn per-domain skill profiles (React, SQL, Rust, parsers, devops, etc.).

Expose `propose_owner(task)` — not binding, but the default matters.

Also: **cost awareness.** Each agent sees peer's token budget and rate-limit headroom. `Plan` has an `estimated_tokens` field. Cheap tasks auto-route to the cheaper model; expensive reasoning to the agent with budget.

---

## Layer 6 — Human as arbiter (not bottleneck)

You, the human, are a first-class **signer** with a configured `intervention_threshold`.

Push to your phone when:

- `Disagreement` exceeds 3 rounds
- `RiskFlag` with severity ≥ high
- `Decision` touches something tagged `human-review-required` (migrations, billing, auth)

The push is a **structured question**, not a chat log:

> Claude and Codex disagree on issue #47.
> **Thesis (Claude):** Use optimistic locking. Evidence: ...
> **Antithesis (Codex):** Use pessimistic. Evidence: ...
> Pick **[A/B/Discuss]**

Reply in 5 seconds from anywhere. Response becomes a signed `Decision` artifact. Coordination unblocks instantly.

---

## Layer 7 — Observability & time-travel

Local web dashboard at `http://localhost:3847`:

- Live DAG of plans / claims / disagreements / commitments
- Click any node → full reasoning trace, all feeding artifacts, both agents' contributions
- Rewind slider: replay the coordination graph from any point in time
- Calibration metrics panel
- Cost panel (tokens, $ equivalent, rate-limit headroom)

The goal: *"why did we merge this?"* becomes a click, not an investigation.

---

## What this unlocks

1. **Bad plans die before code is written.** Not after 3 hours of wasted implementation.
2. **Merges are never a surprise.** The review protocol is the merge gate, always.
3. **Disagreement is bounded.** Structured debate terminates. Endless agent loops can't happen.
4. **The human intervenes rarely but decisively.** Not constant Slack-tending; surgical calls on real conflicts.
5. **The system gets smarter over time.** Calibration + specialization data compounds.
6. **Full auditability.** Why was decision X made? The `Decision` artifact has every signing agent, every feeding `Hypothesis`/`Result`, every `Experiment` run.
7. **Resilient to one agent going rogue.** If Claude goes off the rails, Codex's block on the merge gate prevents damage.

---

## Build stages

- **M0** — foundations (see [ROADMAP.md](../ROADMAP.md))
- **M1** — L0 + L1 + L3 watchdog + core protocols (intent-before-action, merge-requires-review, handoff)
- **M2** — Disagreement + human-broker
- **M3** — L4 calibration + L7 dashboard
- **M4** — L5 specialization routing
- **M5** — Fleet mode (see [fleet-mode.md](fleet-mode.md))

---

## Simulation

An end-to-end walkthrough of two-peer mode handling a real scenario is available in [protocols.md § Simulation](protocols.md#simulation). A fleet-mode simulation (20 workers, 300 issues, 3 days) is in [fleet-mode.md § Simulation](fleet-mode.md#simulation).
