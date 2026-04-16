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

**Pre-alpha.** Design is locked. Implementation begins at M0. Follow the [roadmap](ROADMAP.md).

## Quick links

- 📖 [Design (7-layer architecture)](docs/design.md)
- 📦 [Artifact types (the 12)](docs/artifacts.md)
- 🤝 [Protocols](docs/protocols.md)
- 🚀 [Fleet mode](docs/fleet-mode.md)
- 💸 [Cost & throttling](docs/cost-and-throttling.md)
- 🗺️ [Roadmap](ROADMAP.md)
- 🔧 [Contributing](CONTRIBUTING.md)

## License

MIT — see [LICENSE](LICENSE).
