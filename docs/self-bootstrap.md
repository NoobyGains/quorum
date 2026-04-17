# Self-bootstrap — running Quorum on your machine

Quorum is a working codebase with a passing test suite, but out of the box
it's invisible: if you close your Claude Code or Codex window and open a
new one, nothing is wired up. This doc walks you from "cloned the repo"
to "open a fresh window, Quorum tools are there".

It is **Windows-first** (most of the team is on Windows) with macOS / Linux
notes inline.

> **Status.** This document targets the state of `main` as of the merge
> of issues #52–#60. If any step diverges from reality, that's a bug —
> please open an issue labelled `type:docs`.

---

## TL;DR (the easy path)

```bash
git clone https://github.com/NoobyGains/quorum.git
cd quorum
pnpm install
pnpm -r build
cd packages/cli && npm link
cd ../mcp-server && npm link
cd ../..
quorum install           # registers MCP + hook in ~/.claude.json,
                         # ~/.claude/settings.json, ~/.codex/config.toml
quorum doctor            # sanity-check the environment
```

Restart Claude Code (and Codex if you use it). Done.

`quorum install --dry-run` prints the planned changes first.
`quorum install --uninstall` cleanly reverses every file it touched.
`quorum install --agent claude` or `--agent codex` scopes to one harness.

The sections below document what `quorum install` does under the hood, and
serve as a manual fallback if the installer can't do what you need (e.g.
you want the hook to be *repo-local* rather than user-global).

---

## Prerequisites

| Tool        | Minimum     | Check                               |
| ----------- | ----------- | ----------------------------------- |
| Node.js     | 20          | `node --version`                    |
| pnpm        | 10          | `pnpm --version`                    |
| git         | 2.40+       | `git --version`                     |
| gh CLI      | any         | `gh --version`                      |
| Claude Code | latest      | `claude --version`                  |
| Codex CLI   | latest      | `codex --version` *(optional)*      |

`quorum doctor` (once you have it on PATH) checks all of the above.

**Windows:** use PowerShell or Git Bash. The junction in
`CLAUDE.md` (`Code_chat/quorum → quorum`) is a team-specific workaround —
you don't need it for a fresh install.

**macOS / Linux:** nothing special. A standard Node + pnpm install works.

---

## One-time setup

### 1. Clone and build

```bash
git clone https://github.com/NoobyGains/quorum.git
cd quorum
pnpm install
pnpm -r build
```

`pnpm install` will want to run `better-sqlite3`'s postinstall. If it
prompts about an approval, say yes — the project's root `package.json`
already allow-lists it.

### 2. Verify the test suite

```bash
pnpm -r test
```

You should see every package green. If anything fails, fix that before
wiring into your agent — a broken build will confuse the troubleshooting
steps below.

### 3. Put the CLIs on PATH

The repo exposes two binaries:

- `quorum` — the top-level CLI (`quorum init`, `quorum doctor`,
  `quorum inbox`, `quorum presence`).
- `quorum-mcp-server` — the stdio MCP server that Claude Code and Codex
  launch to talk to the store.

Both are declared under `bin` in their respective `package.json` files
and resolve to `dist/*.js` — so `pnpm -r build` must have succeeded first.

Use `npm link` (or `pnpm link --global`) inside each package:

```bash
cd packages/cli
npm link

cd ../mcp-server
npm link
```

Confirm:

```bash
quorum --version
quorum-mcp-server --help    # prints an MCP banner, then exits
```

If `quorum: command not found`, your global `npm` bin directory isn't on
PATH — run `npm config get prefix`, and add `<prefix>/bin` (POSIX) or
`<prefix>\` (Windows) to your shell's PATH.

---

## Wire Quorum into Claude Code

### 4a. Register the MCP server in `~/.claude.json`

Claude Code reads its global config from `~/.claude.json`. Add a
`mcpServers` entry for Quorum. The file may already contain other
entries — **merge, don't replace**.

```jsonc
{
  "mcpServers": {
    "quorum": {
      "command": "quorum-mcp-server",
      "args": []
    }
  }
}
```

If you did **not** `npm link`, point `command` at the absolute path
instead (forward slashes work on Windows):

```jsonc
"quorum": {
  "command": "node",
  "args": ["C:/Users/you/code/quorum/packages/mcp-server/dist/index.js"]
}
```

Restart Claude Code (close all windows, reopen one). In a new session,
type `/mcp` — you should see `quorum` in the server list, with tools
like `plan.create`, `claim.create`, `artifact.read`, `artifact.list`,
`artifact.search` registered.

### 4b. Add the between-turn hook

See [hooks.md](hooks.md) for the full story. The short version:
at the root of each repo you want Quorum active in, drop this into
`.claude/settings.json`:

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

Restart Claude Code in that repo. Submit a prompt — the turn should now
be prefixed with a Quorum inbox / presence header (empty the first time;
gets interesting once your peer agent is writing artifacts).

**Windows users:** if the hook fails with a shell error, see the
PowerShell variant tracked in issue #75. The bash form above works under
Git Bash and the default Windows shell that Claude Code launches.

---

## Wire Quorum into Codex

### 5a. Register the MCP server in `~/.codex/config.toml`

Codex's MCP config lives in `~/.codex/config.toml`. Append (don't
replace):

```toml
[mcp_servers.quorum]
command = "quorum-mcp-server"
args = []
```

With an absolute path if you didn't `npm link`:

```toml
[mcp_servers.quorum]
command = "node"
args = ["/abs/path/to/quorum/packages/mcp-server/dist/index.js"]
```

Restart Codex. The `quorum` MCP server should appear in its tool
inventory.

### 5b. Between-turn hook equivalent

Codex does not (as of this writing) expose a public `UserPromptSubmit`
equivalent. Until it does, follow the two workarounds in
[hooks.md § Codex](hooks.md#codex--best-effort-instructions) — either
paste the `quorum inbox --unread && quorum presence` output into your
first message, or wrap the Codex launch command.

---

## Per-project initialization

In each repo you want Quorum to track coordination for:

```bash
cd path/to/your/project
quorum init
```

This creates `~/.quorum/<project-hash>/` — a per-project state directory
containing a bare git repo (`store.git`) for the artifact blobs and a
SQLite index (`index.db`) for queries. The hash is canonicalized, so
opening the same repo via a junction or with different drive-letter
casing resolves to the same state dir (see issue #53).

Then, in each terminal window where you're driving an agent, export the
agent identity:

```bash
# Window driving Claude:
export QUORUM_AGENT=claude

# Window driving Codex:
export QUORUM_AGENT=codex
```

PowerShell:

```powershell
$env:QUORUM_AGENT = 'claude'
```

---

## Smoke test

In the repo where you just ran `quorum init`:

```bash
quorum doctor
```

Every critical check should be green. `claude CLI` and `codex CLI` are
optional (they show as warnings if missing — that's fine if you only use
one of them).

Create a fake plan via MCP inside a Claude Code session:

```
@quorum plan.create goal="test bootstrap" approach="see the plan land" \
    files_touched=[] assumptions=[] confidence=0.8 blast_radius=small \
    author=claude project=<your-project-name>
```

Then in any shell:

```bash
quorum inbox --agent claude
quorum presence
```

You should see the plan in the inbox and `claude` as online. If you do,
the wiring is correct.

---

## Troubleshooting

### `quorum doctor` fails on a critical check

- **Node < 20**: upgrade via `nvm` / `fnm` / your package manager.
- **pnpm not found**: `npm i -g pnpm`.
- **gh not found**: install from <https://cli.github.com/>.
- **cwd not inside a git repo**: run `git init` or `cd` into one.

### MCP tools don't show up in Claude Code

- Confirm `quorum-mcp-server --help` runs from a fresh shell (not just
  the one where you ran `npm link`).
- Re-read `~/.claude.json` — JSON parse errors silently disable all MCP
  servers. Validate with `jq . ~/.claude.json`.
- Check Claude Code's MCP log (usually under
  `~/.claude/logs/mcp-*.log`) for a spawn failure.
- Restart Claude Code fully (close all windows). In-window reloads
  don't always pick up new MCP configs.

### MCP tools don't show up in Codex

- Confirm `~/.codex/config.toml` is valid TOML (`python -m tomli < file`).
- Codex's MCP subsystem is newer than Claude's — check
  `codex --version` against the
  [Codex release notes](https://github.com/openai/codex/releases) for
  MCP support in your version.

### Hook doesn't fire in Claude Code

- The hook is repo-local — confirm `.claude/settings.json` is at the
  repo root (not under `.claude/` anywhere else).
- `cd $CLAUDE_PROJECT_DIR` only works inside Claude Code's shell; from a
  plain terminal, `$CLAUDE_PROJECT_DIR` is empty. That's expected.
- Set `CLAUDE_CODE_DEBUG=1` to see hook output in the UI.

### `quorum init` says "already initialized" but queries are empty

- Prior to issue #57, `quorum init` created a placeholder at `state.db`
  while the store opened `index.db`. If you bootstrapped pre-#57, delete
  `~/.quorum/<hash>/state.db` and re-run `quorum init`.

### Agent-name errors

`quorum inbox` rejects agent names that don't match
`/^[a-z][a-z0-9_-]{0,63}$/` (issue #60). If you get
`Invalid agent name`, set `QUORUM_AGENT` to a simple lowercase-alnum
value like `claude` or `codex`.

---

## What's NOT live yet

Be honest with yourself about what Quorum does and doesn't do **today**.
The components below are designed (see `docs/design.md`) and scheduled
in `ROADMAP.md`, but not yet shipped:

- **No watchdog daemon.** Mid-turn push notifications aren't wired —
  agents see each other's work at prompt submission (via the hook) or on
  demand (`quorum inbox`). Watchdog is M1 #31–43.
- **No merge-requires-review gate.** You can land code to `main` without
  a cross-vendor `Review` artifact. That gate is tracked in #47.
- **No disagreement state machine.** Two agents can write conflicting
  `Plan`s; there's no enforced thesis/antithesis/evidence flow yet.
  Tracked in #6.
- **No calibration / outcome ledger.** Agent confidence is stored on
  artifacts but not yet scored against outcomes. M3.
- **No dashboard.** `localhost:3847` doesn't exist yet. M3 #24.
- **No campaign / fleet mode.** The "300 issues in 3 days" workflow is
  M5.

What **is** live: typed artifact store (12 types), per-type CRUD MCP
tools, `quorum inbox` / `presence` / `init` / `doctor` CLI, hook scaffolding
for Claude Code, and the protocol primitives in `@quorum/protocols`
(handoff + intent-window computation). If you're running the bootstrap
because you want to evaluate Quorum's protocol design — that surface is
here.

---

## Next steps

- Read [`docs/protocols.md`](protocols.md) for the
  intended coordination flow.
- Check [`ROADMAP.md`](../ROADMAP.md) for milestone progression.
- File issues at <https://github.com/NoobyGains/quorum/issues>.
- Once `quorum install` (#59) ships, this doc becomes a
  fallback — the happy path will be a single command.
