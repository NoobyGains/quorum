# Quorum

> **A quorum of minds. A quorum of signatures. Nothing ships without both.**

A typed, versioned cognitive workspace for peer AI coding agents — starting with **Claude Code ⇄ Codex**.

Not chat. A shared mind.

---

## The problem

Two capable AI coding agents on one machine, working the same repo, stepping on each other — duplicate work, merge conflicts, silent scope drift, unreviewed code landing in `main`.

Existing "agent-to-agent" tools are messaging services with extra flags. That's the wrong primitive.

## The approach

Replace chat with a **typed, git-backed artifact store** and **protocol-enforced coordination**:

- **Intent-before-action** — every code change is preceded by a `Plan` artifact. Peer gets an objection window. Bad approaches die before code is written.
- **Merge-requires-review** — you cannot land to `main` without a signed `Review` from the *other vendor*. Two-key nuclear launch. Cross-vendor by default, because same-vendor agents share blind spots.
- **Structured disagreement** — disagreements are artifacts with thesis/antithesis/evidence and a 3-round cap. They resolve or escalate to a human. No infinite ping-pong.
- **Calibrated epistemics** — every agent's confidence is tracked against outcomes. Overconfidence gets logged; well-calibrated agents' signatures carry more weight on close calls.
- **Fleet mode** — for 300-issue bug bashes: `Campaign` artifact, Planner role, headless workers in git worktrees, Merge Conductor with backpressure, Findings broadcast to eliminate duplicate work.

## Status

**Pre-alpha. M1 in progress.** 22 issues shipped, 54 open. CLI and MCP are usable today; Rust watchdog daemon and campaign dashboard land in M2.

Seven packages in a pnpm workspace — `@quorum/artifacts`, `@quorum/store`, `@quorum/protocols`, `@quorum/cli`, `@quorum/mcp-server`, `@quorum/watchdog-client`, `create-quorum-app` — with 358 tests passing across the repo.

The `quorum` CLI ships `install`, `doctor`, `inbox`, `presence`, `init`, and (in flight) `sprint`. The MCP server exposes all 12 typed artifacts as tools (`plan_create`, `claim_create`, `hypothesis_create`, `experiment_create`, `result_create`, `decision_create`, `question_create`, `commitment_create`, `disagreement_create`, `handoff_create`, `review_create`, `risk_flag_create`) plus `artifact_read`, `artifact_list`, `artifact_search`, and `ping`.

**Cross-vendor review is live.** This session alone ran two full cycles: Claude wrote code, Codex blocked with structured critiques via the `Review` tool, Claude addressed each point. Issue #56 closed that way. The protocol works end-to-end.

## Try it in 60 seconds

```bash
# one-time: wire MCP + hooks
quorum install

# scaffold a new app
npm create quorum-app my-thing
cd my-thing && pnpm install && pnpm dev
```

`create-quorum-app` scaffolds a Next.js 15 app-router project with a `.quorum/conventions.md` that anchors cross-vendor AI review from commit zero. See the [scaffolded-app README template](packages/create-quorum-app/templates/nextjs/README.md) for what users get.

## Quick links

- 🔌 [**Self-bootstrap** — run Quorum on your machine](docs/self-bootstrap.md)
- 📖 [Design (7-layer architecture)](docs/design.md)
- 📦 [Artifact types (the 12)](docs/artifacts.md)
- 🤝 [Protocols](docs/protocols.md)
- 🚀 [Fleet mode](docs/fleet-mode.md)
- 💸 [Cost & throttling](docs/cost-and-throttling.md)
- 🗺️ [Roadmap](ROADMAP.md)
- 🔧 [Contributing](CONTRIBUTING.md)

## License

MIT — see [LICENSE](LICENSE).
