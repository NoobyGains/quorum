import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initProject,
  projectHash,
  projectStateDir,
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

describe("projectHash", () => {
  it("is a stable 16-char lowercase hex digest of the cwd", () => {
    const a = projectHash("/some/project");
    const b = projectHash("/some/project");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces different hashes for different cwds", () => {
    expect(projectHash("/a")).not.toBe(projectHash("/b"));
  });
});

describe("projectStateDir", () => {
  it("joins homeDir + .quorum + hash", () => {
    const dir = projectStateDir("/home/me", "/proj");
    expect(dir).toBe(join("/home/me", ".quorum", projectHash("/proj")));
  });
});

describe("initProject (filesystem side-effects)", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-init-test-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("creates the state dir, config.json and empty state.db on first run", () => {
    const env = makeEnv({
      cwd: "/project/one",
      homeDir: tmpHome,
      now: () => "2026-04-16T12:00:00.000Z",
    });
    const result = initProject(env);

    expect(result.alreadyInitialized).toBe(false);
    expect(result.stateDir).toBe(projectStateDir(tmpHome, "/project/one"));

    const configRaw = readFileSync(join(result.stateDir, "config.json"), "utf8");
    const config = JSON.parse(configRaw) as ProjectConfig;
    expect(config.project_path).toBe("/project/one");
    expect(config.created_at).toBe("2026-04-16T12:00:00.000Z");
    expect(config.version).toBe("0.0.0");

    const dbStat = statSync(join(result.stateDir, "state.db"));
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

  it("repairs a partial init where state.db was deleted", () => {
    // Simulates an interrupted first run (or manual deletion of state.db)
    // where config.json exists but state.db does not. The fix must NOT
    // short-circuit — it must recreate state.db.
    const env = makeEnv({
      cwd: "/project/partial",
      homeDir: tmpHome,
      now: () => "2026-04-16T00:00:00.000Z",
    });
    const first = initProject(env);
    expect(first.alreadyInitialized).toBe(false);

    const dbPath = join(first.stateDir, "state.db");
    unlinkSync(dbPath);
    expect(existsSync(dbPath)).toBe(false);

    const second = initProject(env);
    // Not a no-op — we had to repair.
    expect(second.alreadyInitialized).toBe(false);
    // state.db must exist again as a zero-byte placeholder.
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
});
