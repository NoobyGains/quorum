import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPlan } from "@quorum/artifacts";
import { INDEX_DB_FILENAME, Store, projectHash, storageRoot } from "@quorum/store";

import {
  GITATTRIBUTES_CONTENT,
  initProject,
  runInit,
  type InitEnv,
  type ProjectConfig,
} from "./init.js";

function makeEnv(overrides: Partial<InitEnv> = {}): InitEnv {
  return {
    cwd: "/fake/project",
    homeDir: "/fake/home",
    now: () => "2026-04-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("initProject (filesystem side-effects)", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-init-test-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("creates the state dir, config.json and empty index.db on first run", () => {
    const env = makeEnv({
      cwd: "/project/one",
      homeDir: tmpHome,
      now: () => "2026-04-16T12:00:00.000Z",
    });
    const result = initProject(env);

    expect(result.alreadyInitialized).toBe(false);
    expect(result.stateDir).toBe(storageRoot("/project/one", tmpHome));

    const configRaw = readFileSync(join(result.stateDir, "config.json"), "utf8");
    const config = JSON.parse(configRaw) as ProjectConfig;
    expect(config.project_path).toBe("/project/one");
    expect(config.created_at).toBe("2026-04-16T12:00:00.000Z");
    expect(config.version).toBe("0.0.0");

    const dbStat = statSync(join(result.stateDir, "index.db"));
    expect(dbStat.size).toBe(0);
  });

  it("is idempotent: running twice reports alreadyInitialized and does not rewrite config", () => {
    const firstTimestamp = "2026-04-16T00:00:00.000Z";
    const secondTimestamp = "2030-01-01T00:00:00.000Z";
    const env1 = makeEnv({
      cwd: "/project/two",
      homeDir: tmpHome,
      now: () => firstTimestamp,
    });
    const first = initProject(env1);
    expect(first.alreadyInitialized).toBe(false);

    const env2 = makeEnv({
      cwd: "/project/two",
      homeDir: tmpHome,
      now: () => secondTimestamp,
    });
    const second = initProject(env2);
    expect(second.alreadyInitialized).toBe(true);
    expect(second.stateDir).toBe(first.stateDir);

    const config = JSON.parse(
      readFileSync(join(second.stateDir, "config.json"), "utf8"),
    ) as ProjectConfig;
    expect(config.created_at).toBe(firstTimestamp);
  });

  it("keeps separate state dirs for different cwds", () => {
    const envA = makeEnv({ cwd: "/proj/a", homeDir: tmpHome });
    const envB = makeEnv({ cwd: "/proj/b", homeDir: tmpHome });
    const a = initProject(envA);
    const b = initProject(envB);
    expect(a.stateDir).not.toBe(b.stateDir);
  });

  it("creates .gitattributes when missing", () => {
    // Per-project root must exist on disk for init to drop the file (the
    // production flow runs against a real cwd). Use a tmp dir as the
    // project root and point homeDir to the same fixture for isolation.
    const projectRoot = mkdtempSync(join(tmpdir(), "quorum-init-ga-"));
    try {
      const env = makeEnv({ cwd: projectRoot, homeDir: tmpHome });
      const gitattributesPath = join(projectRoot, ".gitattributes");
      expect(existsSync(gitattributesPath)).toBe(false);

      initProject(env);

      expect(existsSync(gitattributesPath)).toBe(true);
      expect(readFileSync(gitattributesPath, "utf8")).toBe(
        GITATTRIBUTES_CONTENT,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("leaves an existing .gitattributes untouched", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "quorum-init-ga-"));
    try {
      const gitattributesPath = join(projectRoot, ".gitattributes");
      const bogus = "# user's hand-tuned rules — do not touch\n*.md text\n";
      writeFileSync(gitattributesPath, bogus, "utf8");

      const env = makeEnv({ cwd: projectRoot, homeDir: tmpHome });
      initProject(env);

      expect(readFileSync(gitattributesPath, "utf8")).toBe(bogus);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("repairs a partial init where index.db was deleted", () => {
    // Simulates an interrupted first run (or manual deletion of index.db)
    // where config.json exists but index.db does not. The fix must NOT
    // short-circuit — it must recreate index.db.
    const env = makeEnv({
      cwd: "/project/partial",
      homeDir: tmpHome,
      now: () => "2026-04-16T00:00:00.000Z",
    });
    const first = initProject(env);
    expect(first.alreadyInitialized).toBe(false);

    const dbPath = join(first.stateDir, "index.db");
    unlinkSync(dbPath);
    expect(existsSync(dbPath)).toBe(false);

    const second = initProject(env);
    // Not a no-op — we had to repair.
    expect(second.alreadyInitialized).toBe(false);
    // index.db must exist again as a zero-byte placeholder.
    expect(existsSync(dbPath)).toBe(true);
    expect(statSync(dbPath).size).toBe(0);
    // config.json must be untouched (preserves original created_at).
    const config = JSON.parse(
      readFileSync(join(second.stateDir, "config.json"), "utf8"),
    ) as ProjectConfig;
    expect(config.created_at).toBe("2026-04-16T00:00:00.000Z");
  });
});

describe("runInit", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-init-test-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("prints the 'Initialized Quorum' message on first run and returns 0", async () => {
    const logs: string[] = [];
    const env = makeEnv({ cwd: "/runinit/new", homeDir: tmpHome });
    const code = await runInit({ env, log: (m) => logs.push(m) });
    expect(code).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^Initialized Quorum for \/runinit\/new at /);
    expect(logs[0]).toContain(projectHash("/runinit/new"));
  });

  it("prints the 'already initialized' message on second run and returns 0", async () => {
    const env = makeEnv({ cwd: "/runinit/existing", homeDir: tmpHome });
    await runInit({ env, log: () => {} });

    const logs: string[] = [];
    const code = await runInit({ env, log: (m) => logs.push(m) });
    expect(code).toBe(0);
    expect(logs).toEqual([
      "Quorum is already initialized for /runinit/existing",
    ]);
  });

  // Regression #57: init used to create `state.db` while the store opened
  // `index.db`, so a fresh-init project couldn't round-trip a single
  // artifact. This covers the end-to-end path in one test.
  it("init + Store round-trip: write then list works without manual setup", async () => {
    const cwd = join(tmpHome, "fresh-project");
    const env = makeEnv({ cwd, homeDir: tmpHome });
    const code = await runInit({ env, log: () => {} });
    expect(code).toBe(0);

    const stateDir = storageRoot(cwd, tmpHome);
    expect(existsSync(join(stateDir, INDEX_DB_FILENAME))).toBe(true);

    const store = new Store(cwd, { homeDir: tmpHome });
    try {
      await store.write(
        createPlan({
          id: "pln_rt",
          author: "claude",
          project: "fresh",
          goal: "round-trip",
          approach: "n/a",
          files_touched: [],
          assumptions: [],
          confidence: 0.5,
          blast_radius: "small",
          estimated_tokens: 0,
          risk_flags: [],
          status: "objection_window",
        }),
      );
      const all = await store.list();
      expect(all.map((a) => a.id)).toEqual(["pln_rt"]);
    } finally {
      await store.close();
    }
  });
});
