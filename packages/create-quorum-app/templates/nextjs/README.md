# __APP_NAME__

A Next.js app scaffolded by [`create-quorum-app`](https://github.com/NoobyGains/quorum). Two different-vendor AI agents (Claude + Codex) cross-review each other's work before anything lands.

## Quickstart

```bash
pnpm install
quorum install     # wires the Quorum MCP into both agents (one time)
pnpm dev           # http://localhost:3000
```

Then ask either agent: _"add a feature that ..."_. What you'll see:

1. The agent writes a **Plan** artifact — goal, approach, files it intends to touch.
2. The other agent writes a **Review** artifact — approve, request_changes, or block.
3. If they agree, the code gets written. If they disagree, you see a plain-English diff and pick a side.
4. After code lands, the other agent reviews the diff. Same loop.
5. Every Plan, Review, and Decision is saved. Run `quorum inbox` or `quorum presence` to see the conversation.

## Test

```bash
pnpm test          # vitest — hits the API route handler directly
```

## Spend cap

Set `QUORUM_CAMPAIGN_BUDGET_USD` in `.env`. Soft-warn at target, hard-stop at 2× with checkpoint-and-resume.

## Conventions both agents follow

See [`.quorum/conventions.md`](./.quorum/conventions.md). Edit that file to change how your agents work on this project.

---

Built with Quorum. Replay any decision: `quorum inbox --since 2026-04-17`.
