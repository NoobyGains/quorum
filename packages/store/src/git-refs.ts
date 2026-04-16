// Git-backed artifact storage under `refs/coord/*`. Issue #14.
//
// Each artifact is persisted as a commit in a bare git repo at
// `<storageRoot>/store.git`. The commit has:
//   - a tree containing a single blob `artifact.json` with the full JSON
//   - a message of the form `<Type>:<id>` for log-grep friendliness
//   - a ref `refs/coord/<plural>/<id>` pointing at it
//
// Artifacts are immutable: once the ref exists, we never rewrite it. An
// "update" is a new artifact whose `supersedes` field references the old id
// (see `supersede`). The old ref is left in place for audit history.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Artifact, ArtifactType } from "@quorum/artifacts";
import { ArtifactSchema } from "@quorum/artifacts";
import { simpleGit, type SimpleGit } from "simple-git";

import { gitRepoPath } from "./paths.js";

/**
 * Plural ref-namespace segment for each artifact type, matching the
 * `refs/coord/<plural>/<id>` convention in docs/design.md § Layer 0.
 *
 * Most are just lowercase + "s" but `RiskFlag` and `Handoff` get explicit
 * spellings (`risk-flags`, `handoffs`) so callers don't have to reverse-engineer
 * the rule.
 */
const TYPE_TO_PLURAL: Record<ArtifactType, string> = {
  Plan: "plans",
  Claim: "claims",
  Hypothesis: "hypotheses",
  Experiment: "experiments",
  Result: "results",
  Decision: "decisions",
  Question: "questions",
  Commitment: "commitments",
  Disagreement: "disagreements",
  Handoff: "handoffs",
  Review: "reviews",
  RiskFlag: "risk-flags",
};

/**
 * Compute the ref name for a given artifact. Exported so callers that need
 * to talk about refs directly (watchdog, CLI) stay aligned with the store.
 */
export function refForArtifact(artifact: Artifact): string {
  const plural = TYPE_TO_PLURAL[artifact.type];
  return `refs/coord/${plural}/${artifact.id}`;
}

/** All `refs/coord/<plural>/` prefixes — useful for listing. */
const ALL_REF_PREFIXES: string[] = Object.values(TYPE_TO_PLURAL).map(
  (p) => `refs/coord/${p}/`,
);

export interface GitRefsStoreOptions {
  /**
   * Optional author override for the artifact commit's author/committer.
   * Defaults to `quorum <quorum@local>`.
   */
  committer?: { name: string; email: string };
}

export class GitRefsStore {
  private readonly repoPath: string;
  private readonly git: SimpleGit;
  private readonly committer: { name: string; email: string };
  private initPromise: Promise<void> | null = null;

  constructor(storageRoot: string, opts: GitRefsStoreOptions = {}) {
    this.repoPath = gitRepoPath(storageRoot);
    mkdirSync(this.repoPath, { recursive: true });
    this.git = simpleGit(this.repoPath);
    this.committer = opts.committer ?? {
      name: "quorum",
      email: "quorum@local",
    };
  }

  /**
   * Lazy bare-repo init. Idempotent — re-initializing an existing bare repo
   * is a no-op for our purposes (refs/objects are preserved).
   */
  private ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        // `git init --bare` is idempotent; simple-git doesn't expose a
        // cheap "is-initialized" check that works for bare repos, so just
        // call init every time the instance is constructed.
        await this.git.init(true);
        // Ensure deterministic committer identity. `-c` on each raw call is
        // equally valid, but per-repo config keeps the raw calls shorter.
        await this.git.addConfig("user.name", this.committer.name, false, "local");
        await this.git.addConfig(
          "user.email",
          this.committer.email,
          false,
          "local",
        );
      })();
    }
    return this.initPromise;
  }

  /**
   * Write an artifact as a new commit + ref. Returns the commit sha. If a
   * ref already exists for this id, this is a no-op (returns the existing
   * sha) — artifacts are immutable by design.
   */
  async write(artifact: Artifact): Promise<{ sha: string }> {
    await this.ensureInit();

    const ref = refForArtifact(artifact);
    const existing = await this.resolveRef(ref);
    if (existing) {
      return { sha: existing };
    }

    const json = JSON.stringify(artifact, null, 2) + "\n";

    // Plumbing pipeline: blob -> tree -> commit -> ref. Using temp files for
    // stdin-ish inputs because simple-git's `raw` doesn't forward stdin.
    const scratch = mkdtempSync(join(tmpdir(), "quorum-store-"));
    try {
      const jsonFile = join(scratch, "artifact.json");
      writeFileSync(jsonFile, json, "utf8");

      // 1. hash the blob and write it into the object store.
      const blobSha = (
        await this.git.raw(["hash-object", "-w", jsonFile])
      ).trim();

      // 2. build a tree object containing exactly `artifact.json -> blob`.
      //    `git mktree` would be the idiomatic tool but it needs stdin,
      //    which simple-git's `raw` doesn't expose. Instead we serialize
      //    the tree by hand (see writeTreeWithSingleFile) and hash it.
      const treeSha = await this.writeTreeWithSingleFile(
        scratch,
        "artifact.json",
        blobSha,
      );

      // 3. commit-tree with our deterministic message + committer. We set
      //    user identity via `-c` on the invocation so the commit is
      //    reproducible even if global git config differs.
      const message = `${artifact.type}:${artifact.id}`;
      const commitSha = (
        await this.git.raw([
          "-c",
          `user.name=${this.committer.name}`,
          "-c",
          `user.email=${this.committer.email}`,
          "commit-tree",
          treeSha,
          "-m",
          message,
        ])
      ).trim();

      // 4. point the ref at the commit.
      await this.git.raw(["update-ref", ref, commitSha]);

      return { sha: commitSha };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  /**
   * Build a git tree object containing exactly one entry (`artifact.json`
   * -> blob). Writes it into the object store and returns its sha.
   *
   * We write the raw tree binary to a file and call `git hash-object -w
   * -t tree <file>`. Tree format:
   *   `100644 artifact.json\0<20-byte-binary-sha>`
   */
  private async writeTreeWithSingleFile(
    scratchDir: string,
    filename: string,
    blobSha: string,
  ): Promise<string> {
    const header = Buffer.from(`100644 ${filename}\0`, "utf8");
    const shaBin = Buffer.from(blobSha, "hex");
    if (shaBin.length !== 20) {
      throw new Error(
        `unexpected blob sha length: ${blobSha} (${shaBin.length} bytes)`,
      );
    }
    const tree = Buffer.concat([header, shaBin]);
    const treeFile = join(scratchDir, "tree.bin");
    writeFileSync(treeFile, tree);
    const sha = (
      await this.git.raw(["hash-object", "-w", "-t", "tree", treeFile])
    ).trim();
    return sha;
  }

  /**
   * Resolve a ref to its commit sha, returning null if the ref doesn't
   * exist. `show-ref --verify --quiet` would exit non-zero; we use
   * `rev-parse` and translate the "unknown revision" error into null.
   */
  private async resolveRef(ref: string): Promise<string | null> {
    try {
      const sha = (
        await this.git.raw(["rev-parse", "--verify", "--quiet", `${ref}^{}`])
      ).trim();
      return sha || null;
    } catch {
      return null;
    }
  }

  /**
   * Read the artifact JSON at the commit pointed to by `ref`. Returns null
   * if the ref doesn't exist or the blob can't be parsed.
   */
  async readByRef(ref: string): Promise<Artifact | null> {
    await this.ensureInit();
    const sha = await this.resolveRef(ref);
    if (!sha) return null;
    return this.readBlobFromCommit(sha);
  }

  private async readBlobFromCommit(commitSha: string): Promise<Artifact | null> {
    let blobContent: string;
    try {
      blobContent = await this.git.raw([
        "show",
        `${commitSha}:artifact.json`,
      ]);
    } catch {
      return null;
    }
    const parsed = ArtifactSchema.safeParse(JSON.parse(blobContent));
    return parsed.success ? parsed.data : null;
  }

  /**
   * Find an artifact by id across every type namespace. O(types) ref lookups.
   */
  async read(id: string): Promise<Artifact | null> {
    await this.ensureInit();
    for (const prefix of ALL_REF_PREFIXES) {
      const ref = `${prefix}${id}`;
      const sha = await this.resolveRef(ref);
      if (sha) {
        return this.readBlobFromCommit(sha);
      }
    }
    return null;
  }

  /** Idempotence helper — cheap existence check. */
  async exists(id: string): Promise<boolean> {
    return (await this.read(id)) !== null;
  }

  /**
   * List all artifacts, optionally filtered by type and/or author.
   *
   * Walks refs via `for-each-ref` which is cheap even for thousands of refs.
   */
  async list(filter?: {
    type?: ArtifactType;
    author?: string;
  }): Promise<Artifact[]> {
    await this.ensureInit();

    const prefixes =
      filter?.type !== undefined
        ? [`refs/coord/${TYPE_TO_PLURAL[filter.type]}/`]
        : ALL_REF_PREFIXES;

    const results: Artifact[] = [];
    for (const prefix of prefixes) {
      const raw = await this.git
        .raw(["for-each-ref", "--format=%(objectname) %(refname)", prefix])
        .catch(() => "");
      const lines = raw.split("\n").filter((l) => l.trim() !== "");
      for (const line of lines) {
        const idx = line.indexOf(" ");
        if (idx === -1) continue;
        const sha = line.slice(0, idx);
        const artifact = await this.readBlobFromCommit(sha);
        if (!artifact) continue;
        if (filter?.author !== undefined && artifact.author !== filter.author) {
          continue;
        }
        results.push(artifact);
      }
    }
    return results;
  }

  /**
   * Write a superseding artifact. Enforces `next.supersedes === oldId` and
   * that `oldId` exists. Does NOT delete or rewrite the old ref — history
   * is append-only.
   */
  async supersede(
    oldId: string,
    next: Artifact,
  ): Promise<{ sha: string }> {
    if (next.supersedes !== oldId) {
      throw new Error(
        `supersede: next.supersedes must equal ${oldId} (got ${String(
          next.supersedes,
        )})`,
      );
    }
    const prior = await this.read(oldId);
    if (!prior) {
      throw new Error(`supersede: no artifact with id ${oldId}`);
    }
    return this.write(next);
  }
}
