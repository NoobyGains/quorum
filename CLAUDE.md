# CLAUDE.md — Session state & pickup notes

This file is auto-loaded by Claude Code when opened in this repo. Any future session (mine or another agent's) should read it first to avoid re-learning context.

## Project identity

**Quorum** — typed, git-backed cognitive workspace for peer AI coding agents (Claude + Codex). Not chat. A shared mind. Pre-alpha; 14/48 issues shipped; see `ROADMAP.md`.

**GitHub:** https://github.com/NoobyGains/quorum (private)
**Maintainer:** David Innes (`NoobyGains`, `defendeuw@gmail.com`)
**Platform:** Windows 11 primary; cross-platform CI matrix

## Pending housekeeping decisions

### Branch protection on `main` — **not enabled**
GitHub Free rejected protection on a private repo. Three options, undecided:

1. Flip repo to public (one command: `gh repo edit NoobyGains/quorum --visibility public`)
2. Upgrade to GitHub Pro (~$4/mo per user)
3. Skip until M1 is complete and we're ready to enforce

### Projects v2 kanban — **not created**
Requires extra token scope. To enable, user must run interactively:
```bash
gh auth refresh -s project,write:discussion
```
Then reopen the Claude session and I can create the board.

### 24-issue backlog seeding — **partially seeded, may be incomplete**
The session that shipped M1 dispatched a sub-agent to seed 24 follow-up issues from Codex's project review + session learnings. The machine was shut down before it finished. Check `gh issue list --state open` — if counts below ~34 (the 24 new + existing 10 M1 leftovers), re-dispatch the seeding worker. Full spec of the 24 issues lives in conversation history from commit `8ef2d75` — can reconstruct from Codex review + CLAUDE.md context.

## Invariants

### The junction point
On Windows, there's a directory junction:
```
C:\Users\David\Desktop\Projects\Code_chat\quorum  →  C:\Users\David\Desktop\Projects\quorum
```
Purpose: Codex sandbox is locked to the Claude Code session root (`Code_chat/`). The junction lets Codex read/write to the real repo via `Code_chat/quorum/...`. **Do not delete.** If it's gone, recreate via:
```powershell
New-Item -ItemType Junction -Path 'C:/Users/David/Desktop/Projects/Code_chat/quorum' -Target 'C:/Users/David/Desktop/Projects/quorum'
```

### Global Claude Code experimental flags — **on**
In `~/.claude/settings.json`:
```json
"env": {
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
  "CLAUDE_CODE_PLAN_V2_AGENT_COUNT": "5",
  "CLAUDE_CODE_COORDINATOR_MODE": "1"
}
```
User wants these always on. Not Quorum-specific, but enables the sub-agent orchestration pattern we use to build Quorum.

### Codex cross-vendor review pattern
When Claude writes substantial code, dispatch Codex via `codex:codex-rescue` with a structured review rubric (see `docs/protocols.md § Merge-requires-review`). Codex:
- CAN read the repo through the junction (`Code_chat/quorum/...`)
- CANNOT write outside its sandbox root unless we do the emit-as-text proxy pattern
- CANNOT access `gh` CLI for the private repo (use local filesystem only)

### Git identity (local repo only)
```
user.name  = David Innes
user.email = NoobyGains@users.noreply.github.com
```
Set with `git config` (not `--global`). Every file writes CRLF warnings on commit — `.gitattributes` fix tracked as issue (find in backlog once seeding completes).

### Native module
`better-sqlite3` needs its prebuild approved. Root `package.json` has:
```json
"pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] }
```
Any fresh clone needs `pnpm install` + possibly `pnpm rebuild better-sqlite3` before tests run.

## Next-session priorities (as of commit 8ef2d75)

1. **Confirm 24-issue backlog seeding is complete** — `gh issue list --state open | wc -l` should be ≥30
2. **Fix Codex's 3 must-fix bugs** (cited `file:line` in review):
   - `packages/store/src/store.ts:65-70` — silent SQLite degradation; artifacts write to git but disappear from queries
   - `packages/store/src/paths.ts:15-26` — Windows `sha1(cwd)` splits state across junctions/casing
   - `packages/mcp-server/src/tools/create.ts:720-724` — `review.create` fabricates `target_plan`
3. **Ship `quorum install`** (#59) + **self-bootstrap doc** (#58) — make Quorum actually active in a fresh Claude/Codex window
4. **Rust watchdog daemon** (M1 #31-43) — requires rustup check first
5. **Live E2E demo** (M1 #50) — the protocol-in-action proof

## Active test count

242 tests across 27 files as of `8ef2d75`. If this number drops unexpectedly, investigate before adding features.

```
@quorum/artifacts          95 tests (13 files)
@quorum/store              22 tests (3 files)
@quorum/mcp-server         39 tests (3 files)
@quorum/cli                73 tests (5 files)
@quorum/protocols          12 tests (2 files)
@quorum/watchdog-client     1 test  (1 file)
                          ---
                          242 tests (27 files)
```

## Style notes

- User prefers terse, direct responses — no yes-ma'am padding
- User types in all-caps when excited; doesn't mean anger
- When user says "build all this," reality-check the scope in 2-3 sentences before dispatching
- Cross-vendor work (Claude + Codex) is the core thesis — favor it over same-vendor even when same-vendor is faster
- Don't use "dogfooding" — user flagged it as jargon. Say "using Quorum to build Quorum" or similar.

## How to pick up where we left off

1. Read `ROADMAP.md` for the big picture
2. Read `docs/design.md` for the 7-layer architecture
3. Run `gh issue list --repo NoobyGains/quorum --state open --limit 50` for current backlog
4. Check `git log --oneline -10` for what landed recently
5. `pnpm install && pnpm -r test` — should pass 242 tests before you change anything
6. Pick a milestone from `ROADMAP.md` or a bug from the must-fix trio above

---

*Last updated: end of session that shipped M1 Wave 3 (commit `8ef2d75`, 2026-04-16).*
