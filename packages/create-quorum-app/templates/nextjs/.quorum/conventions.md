# Project conventions

Both Claude and Codex read this file before writing a Plan. Edit freely — these are YOUR conventions for this project.

## Process

1. **Test-first.** Every new feature ships with a Vitest test. If you can't write the test, you don't understand the feature yet.
2. **Plan before code.** Publish a Plan artifact via `mcp__quorum__plan_create` before touching any file. Small changes (<5 lines) may skip the Plan; anything else needs one.
3. **Cross-vendor review is mandatory.** The other agent must approve the Plan (and, for larger changes, the diff) before merge. Disagreements surface to the human — don't swallow them.
4. **No secrets in code.** API keys, tokens, and passwords go in `.env`, never in `.tsx` / `.ts` / `.json` files.

## Code

1. **Route handlers** return typed JSON via `NextResponse.json(...)`. Document the shape in the handler file.
2. **Server components by default.** Only add `"use client"` when you genuinely need interactivity or browser APIs.
3. **App Router only.** Do not create files under `/pages/`.
4. **Imports** use the `@/*` alias for project-relative paths. Avoid deep relative chains.
5. **Errors surface.** No silent `catch (err) { /* noop */ }`. If you can't handle the error, let it propagate.

## Tests

1. Vitest, colocated under `test/`.
2. Test the route handlers directly (import `GET` / `POST` from the route file and call them). No dev-server spin-up in tests.
3. Every test asserts on **shape and values**, not just "no throw".

## UI

1. System fonts by default. Don't pull in Google Fonts or web fonts unless the user asks.
2. Keep global CSS under 100 lines. Use CSS modules or inline styles for component-scoped styling.
3. Dark mode via `color-scheme: light dark` and system colors. No theme toggle unless asked.

## What the agents should NOT do

- Don't add analytics, telemetry, or third-party SDKs without an explicit Decision artifact.
- Don't refactor unrelated code while implementing a feature.
- Don't add backwards-compatibility shims for code that doesn't exist yet.
- Don't write multi-paragraph docstrings. One short line above a function is plenty.
