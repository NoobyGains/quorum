# Contributing to Quorum

Quorum is in pre-alpha. Nearly every issue is up for grabs. Here's how to jump in.

## Picking an issue

1. Browse open issues and filter by `good-first-issue` or a milestone (M0 is easiest).
2. Comment `I'll take this` so others don't duplicate.
3. If it's a design question, prefer `type:spike` issues — short investigations that produce a decision, not production code.

## Branch & commit

- Branch from `main`: `feat/<short-desc>`, `fix/<short-desc>`, `docs/<short-desc>`
- Commit messages: [Conventional Commits](https://www.conventionalcommits.org/) style
  - `feat(artifacts): add Plan schema + validator`
  - `fix(watchdog): handle renamed files on Windows`
- Keep commits scoped and bisectable

## Pull requests

Every PR needs:

- [ ] Linked issue (`Closes #42`)
- [ ] Tests for new behavior
- [ ] Updated docs if protocol/interface changed
- [ ] CI green on all three OSes
- [ ] One reviewer approval

Once Quorum can dogfood itself (target: M1+), reviews must come from a **different-vendor** sub-agent (cross-vendor merge gate). Until then, human review is fine.

## Design changes

Protocol or schema changes = open a `type:design` spike issue **first**. Merging code that changes an artifact schema or protocol without a design discussion will be reverted.

## Code style

- TypeScript strict, no `any`
- Prefer narrow types + schema validation at boundaries
- Keep files focused; when a file grows past ~300 lines, consider if it's doing too much
- Small, well-named functions. Identifiers should make comments unnecessary.
- Tests use Vitest; integration tests use a real temp git repo, not mocks

## What *not* to do

- Don't add dependencies without discussion (`pnpm add` + PR message justification)
- Don't bypass the merge gate by admin-pushing. If the gate is broken, fix the gate.
- Don't rewrite history on `main`. Rebase on your own branches; merge commits are fine on `main`.
- Don't add features not on the [roadmap](ROADMAP.md) without a spike issue first.

## Running it locally

_Coming in M0._ For now, see [docs/design.md](docs/design.md) and [docs/protocols.md](docs/protocols.md).

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Quorum is a small project with one primary maintainer. Be kind. Disagreements are fine; abuse is not.
