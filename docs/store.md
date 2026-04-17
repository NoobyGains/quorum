# Store — the dual-layer artifact store

The `@quorum/store` package is the single entry point for persisting and
querying artifacts. It wires together two independent layers:

| Layer  | Backed by             | Role                                          |
| ------ | --------------------- | --------------------------------------------- |
| git    | `refs/coord/<t>/<id>` | **source of truth** — immutable, append-only  |
| sqlite | `index.db`            | **derived cache** — fast list / search / FTS5 |

Git is authoritative. SQLite exists only to make queries cheap. Anything in
SQLite can be reconstructed by walking the refs.

---

## Write contract

`Store.write(artifact)` and `Store.supersede(oldId, next)` are atomic from
the caller's perspective:

1. Validate the artifact against its Zod schema. Throws on schema failure.
2. Write to git. Throws if the git write fails; nothing else has run.
3. Index in SQLite. **Throws if the index write fails.**

If step 3 throws, the git layer already has the artifact. That is fine:

- Git is append-only and idempotent on `id` — retrying `write` is safe.
- `SqliteIndex.index` is `DELETE + INSERT` inside one transaction, so retries
  don't leave a partial row.
- The caller sees the failure synchronously and can retry or escalate.

### Why not warn-and-continue?

The prior contract logged SQLite failures as warnings and returned success.
Because every query method (`list`, `search`, `latestOfType`, `supersededBy`)
reads **only** from SQLite, a failed index write meant the artifact was in
git but invisible to inbox / presence / mcp-tool surfaces. This silently
destroyed coordination data. See issue #52.

---

## Query contract

| Method          | Backing store                          |
| --------------- | -------------------------------------- |
| `read(id)`      | sqlite point lookup, falls back to git |
| `list(filter)`  | sqlite                                 |
| `search(fts)`   | sqlite (FTS5)                          |
| `latestOfType`  | sqlite                                 |
| `supersededBy`  | sqlite                                 |

`read` is the only method that falls back to git. The list / search / latest
family is sqlite-only because walking refs on every call would be O(refs).
If the index is out of sync for any reason, callers should expect stale
answers and run `rebuildIndex` before trusting list results.

---

## Recovery: `rebuildIndex`

```ts
const count = await store.rebuildIndex();
```

Walks every `refs/coord/<t>/<id>` ref, reads the artifact blob, and
re-indexes it into SQLite. Intended for:

- Manual recovery after deleting or corrupting `index.db`.
- Bootstrap of a fresh clone (once that ships as a CLI command).
- Periodic reconciliation in the watchdog (future).

Existing rows are overwritten by the `DELETE + INSERT` inside
`SqliteIndex.index`, so it is safe to run against a live index.

`rebuildIndex` does **not** delete orphan SQLite rows that have no
corresponding git ref. Because git is append-only in this system, orphans
should not occur in normal operation. If they do, drop `index.db` and
re-run `rebuildIndex`.

---

## Options

```ts
new Store(cwd, { homeDir?: string })
```

`homeDir` overrides `os.homedir()` — useful for tests and alternative
install roots. No other knobs; the index-failure contract is hard-wired.
