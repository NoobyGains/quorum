# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, email: `defendeuw@gmail.com` with the subject line `[quorum security]`.

Include:

- A description of the issue
- Steps to reproduce
- Impact assessment (what an attacker can do)
- Any suggested fix

You'll get a response within 72 hours. Once triaged, we'll coordinate a fix and responsible-disclosure timeline.

## Scope

Quorum coordinates AI agents that *execute code and shell commands on your machine*. Reasonable concerns include:

- Privilege escalation via crafted artifacts
- Injection of malicious content into agent contexts via artifact fields
- Bypass of the merge-requires-review gate
- Leakage of private repository content through coordination artifacts

Out of scope (until M3+): mock/staging environments, rate-limiting the server itself, cross-machine relay (doesn't exist yet).

## Supported versions

Pre-alpha — only `main` is supported. Tagged pre-releases are demo-only, not for production.
