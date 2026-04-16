# Hooks — wiring Quorum into Claude Code and Codex

Agents only coordinate when they *see* each other's artifacts. Polling is
wasteful; the watchdog (see [design.md § Layer 3](design.md)) gives us push.
Between turns — i.e. every time you send a new prompt — we inject a short
header summarising what's unread and who's online. That's this document.

Setup takes one file per window.

---

## What's a UserPromptSubmit hook?

Claude Code supports a `UserPromptSubmit` hook that runs a shell command
every time you submit a prompt. Its stdout gets prepended to the turn's
context. See Anthropic's
[Claude Code hooks reference](https://docs.claude.com/en/docs/claude-code/hooks)
for the full lifecycle; the Quorum pieces below are just well-behaved
commands.

Two Quorum subcommands are designed for this slot:

- `quorum inbox --unread` — prints the artifacts addressed to *you* since the
  last time the hook ran. Advances a per-agent `last_seen` watermark so you
  don't re-read old items every turn.
- `quorum presence` — prints who else in the project has been active in the
  last 15 minutes.

Both exit 0 on success (even if they have nothing to say), print to stdout
only, and take no required arguments — exactly the shape Claude Code expects.

---

## Claude Code — `.claude/settings.json`

Drop this into `.claude/settings.json` at the root of your repo. The
`cd $CLAUDE_PROJECT_DIR` makes `quorum` resolve against the project root
even if you opened Claude Code inside a subdirectory.

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "cd $CLAUDE_PROJECT_DIR && npx quorum inbox --unread && npx quorum presence"
      }]
    }]
  }
}
```

Once committed, every prompt you send Claude will start with something like:

```
[quorum] 2 unread for claude since 2026-04-16T14:00:00Z:
  pln_9c1   Plan         from codex   "Rate-limit /api/users with Redis"   2m ago
  rev_2a    Review       from codex   request_changes on c81fa03           20s ago
[quorum] online:
  claude  last active 30s ago  (last action: wrote pln_9c1)
  codex   last active 4m ago   (last action: handed off hnd_7b)
```

That header lands *before* your prompt text, so Claude sees it as ambient
context — no prompt-engineering from you required.

### A note on stdin

Claude Code's UserPromptSubmit hook passes metadata about the current prompt
on stdin. The snippet above doesn't read it — the Quorum commands only need
the project's working directory and (optionally) `QUORUM_AGENT`. If you
extend the hook with your own scripts, read stdin there; Quorum will ignore
whatever you pipe to it.

---

## Per-window agent identity

Every CLI window (or terminal tab) in the Claude+Codex workflow represents a
single agent identity. `quorum inbox` needs to know which one is "me" so it
can filter correctly.

```bash
# In the window driving Claude:
export QUORUM_AGENT=claude

# In the window driving Codex:
export QUORUM_AGENT=codex
```

If `QUORUM_AGENT` is unset, `quorum inbox` defaults to `claude`. You can
also pass `--agent <name>` explicitly:

```bash
quorum inbox --unread --agent claude
```

Use the explicit flag in shared scripts (e.g. a hook someone else might run
without your `.bashrc`). Use the env var for your own interactive shells.

---

## Codex — best-effort instructions

Codex's CLI does not (as of this writing) expose a public `UserPromptSubmit`
equivalent. Until it does, the two workable approximations are:

1. **Boot the prompt manually.** Add a line to your first message each
   session:

   ```
   Here is your inbox / presence header — treat this as context:
   <paste output of `quorum inbox --unread && quorum presence`>
   ```

2. **Wrap the launch.** If you invoke Codex via a shell wrapper, have the
   wrapper run `quorum inbox --unread` and prepend the output to the
   initial prompt.

If/when Codex adds a first-class submission hook, this section will be
updated. **TBD.**

---

## Troubleshooting

- **`quorum: command not found`** — the hook runs with a minimal env. Either
  install `@quorum/cli` globally (`npm i -g @quorum/cli`) or use
  `npx quorum` as shown above.
- **Empty inbox every turn** — `--unread` advances the watermark on every
  invocation. If you want to see *everything* unread so far, drop
  `--unread` and pass `--since 1970-01-01T00:00:00Z` instead.
- **Wrong agent** — check `echo $QUORUM_AGENT` in the window; Claude Code
  inherits the shell env that launched it.
- **First run on a fresh repo** — if you haven't run `quorum init`, the
  hook will still exit 0 (with zero unread, nobody online). Run
  `quorum init` once to create the state dir.

---

## See also

- [protocols.md § Handoff protocol](protocols.md#handoff-protocol) — the
  structured end-of-turn artifact that powers the inbox.
- [design.md § Layer 3](design.md) — why we prefer push-via-hook over
  polling.
