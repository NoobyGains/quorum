import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClaim, createPlan, type Artifact } from "@quorum/artifacts";
import { simpleGit } from "simple-git";

import { GitRefsStore, refForArtifact } from "./git-refs.js";
import { gitRepoPath } from "./paths.js";

function makePlan(id = "pln_t1", overrides: Partial<Parameters<typeof createPlan>[0]> = {}) {
  return createPlan({
    id,
    author: "claude",
    project: "quorum-test",
    goal: "test goal",
    approach: "test approach",
    files_touched: ["src/a.ts"],
    assumptions: [],
    confidence: 0.9,
    blast_radius: "small",
    estimated_tokens: 100,
    risk_flags: [],
    status: "objection_window",
    ...overrides,
  });
}

function makeClaim(id = "clm_t1") {
  return createClaim({
    id,
    author: "codex",
    project: "quorum-test",
    target: "gh-issue-1",
    agent: "codex",
    exclusive: true,
    ttl_seconds: 3600,
    reason: "testing",
  });
}

describe("GitRefsStore", () => {
  let tmp: string;
  let store: GitRefsStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "quorum-store-git-"));
    store = new GitRefsStore(tmp);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes and reads back a Plan", async () => {
    const plan = makePlan("pln_rw1");
    const { sha } = await store.write(plan);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    const got = await store.read("pln_rw1");
    expect(got).not.toBeNull();
    expect(got?.type).toBe("Plan");
    expect(got?.id).toBe("pln_rw1");
  });

  it("uses refs/coord/<plural>/<id> naming", () => {
    const plan = makePlan("pln_r1");
    expect(refForArtifact(plan)).toBe("refs/coord/plans/pln_r1");
    const claim = makeClaim("clm_r1");
    expect(refForArtifact(claim)).toBe("refs/coord/claims/clm_r1");
  });

  it("readByRef resolves a specific ref name", async () => {
    const plan = makePlan("pln_rb1");
    await store.write(plan);
    const got = await store.readByRef("refs/coord/plans/pln_rb1");
    expect(got?.id).toBe("pln_rb1");
  });

  it("returns null for unknown ids", async () => {
    expect(await store.read("pln_missing")).toBeNull();
    expect(await store.readByRef("refs/coord/plans/pln_missing")).toBeNull();
    expect(await store.exists("pln_missing")).toBe(false);
  });

  it("list filters by type", async () => {
    await store.write(makePlan("pln_l1"));
    await store.write(makePlan("pln_l2"));
    await store.write(makeClaim("clm_l1"));

    const plans = await store.list({ type: "Plan" });
    expect(plans.map((a) => a.id).sort()).toEqual(["pln_l1", "pln_l2"]);

    const claims = await store.list({ type: "Claim" });
    expect(claims.map((a) => a.id)).toEqual(["clm_l1"]);
  });

  it("list filters by author", async () => {
    await store.write(makePlan("pln_a1", { author: "claude" }));
    await store.write(makePlan("pln_a2", { author: "codex" }));
    const claudePlans = await store.list({ author: "claude" });
    expect(claudePlans.map((a) => a.id)).toEqual(["pln_a1"]);
  });

  it("is idempotent: re-writing the same id returns the same sha (no overwrite)", async () => {
    const plan = makePlan("pln_idem");
    const first = await store.write(plan);
    const second = await store.write(plan);
    expect(second.sha).toBe(first.sha);
  });

  it("supersede writes a new artifact referencing the old id and leaves old ref alone", async () => {
    const v1 = makePlan("pln_s1");
    await store.write(v1);

    const v2: Artifact = makePlan("pln_s2", {
      supersedes: "pln_s1",
      version: 2,
    });
    await store.supersede("pln_s1", v2);

    // Both refs still resolve.
    expect(await store.exists("pln_s1")).toBe(true);
    expect(await store.exists("pln_s2")).toBe(true);

    const got = await store.read("pln_s2");
    expect(got?.supersedes).toBe("pln_s1");
  });

  it("supersede rejects mismatched supersedes field", async () => {
    const v1 = makePlan("pln_mis1");
    await store.write(v1);

    const badV2 = makePlan("pln_mis2", { supersedes: "pln_other", version: 2 });
    await expect(store.supersede("pln_mis1", badV2)).rejects.toThrow(
      /supersedes must equal/,
    );
  });

  it("supersede rejects when the old id doesn't exist", async () => {
    const v2 = makePlan("pln_orph", { supersedes: "pln_nope", version: 2 });
    await expect(store.supersede("pln_nope", v2)).rejects.toThrow(
      /no artifact with id/,
    );
  });

  // Regression #55: readByRef's doc promises a null return when the blob
  // can't be parsed, but JSON.parse was outside the surrounding try/catch,
  // so a corrupt blob threw SyntaxError up through every caller.
  it("readByRef returns null when the blob is not valid JSON", async () => {
    // Seed a real artifact so the bare repo is initialized.
    await store.write(makePlan("pln_seedcorrupt"));

    // Now plant a corrupt blob at refs/coord/plans/pln_corrupt using the
    // same plumbing the store uses (hash-object + mktree-by-hand + commit).
    const repoPath = gitRepoPath(tmp);
    const git = simpleGit(repoPath);
    const scratch = mkdtempSync(join(tmpdir(), "quorum-corrupt-"));
    try {
      const badFile = join(scratch, "artifact.json");
      writeFileSync(badFile, "this is not JSON {{{", "utf8");
      const blobSha = (
        await git.raw(["hash-object", "-w", badFile])
      ).trim();
      // Tree format: "100644 artifact.json\0<20-byte-binary-sha>"
      const header = Buffer.from("100644 artifact.json\0", "utf8");
      const shaBin = Buffer.from(blobSha, "hex");
      const treeBin = Buffer.concat([header, shaBin]);
      const treeFile = join(scratch, "tree.bin");
      writeFileSync(treeFile, treeBin);
      const treeSha = (
        await git.raw(["hash-object", "-w", "-t", "tree", treeFile])
      ).trim();
      const commitSha = (
        await git.raw([
          "-c",
          "user.name=test",
          "-c",
          "user.email=test@local",
          "commit-tree",
          treeSha,
          "-m",
          "corrupt",
        ])
      ).trim();
      await git.raw([
        "update-ref",
        "refs/coord/plans/pln_corrupt",
        commitSha,
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }

    await expect(
      store.readByRef("refs/coord/plans/pln_corrupt"),
    ).resolves.toBeNull();
    // `read` shares the same parse path — exercise it too.
    await expect(store.read("pln_corrupt")).resolves.toBeNull();
  });
});
