import { describe, it, expect } from "vitest";
import type { SpawnOptions } from "node:child_process";
import {
  exitCodeFor,
  formatReport,
  parseNodeMajor,
  runChecks,
  runDoctor,
  type CheckResult,
  type CommandRunner,
  type DoctorEnv,
  type FsProbe,
} from "./doctor.js";

interface StubSpec {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  /** If true, simulate the binary being missing (spawn error). */
  missing?: boolean;
}

function makeRunner(table: Record<string, StubSpec>): CommandRunner {
  return async (cmd: string, _args: readonly string[], _opts?: SpawnOptions) => {
    const spec = table[cmd];
    if (!spec || spec.missing) {
      const err = new Error(`ENOENT: command not found: ${cmd}`);
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    }
    return {
      exitCode: spec.exitCode ?? 0,
      stdout: spec.stdout ?? "",
      stderr: spec.stderr ?? "",
    };
  };
}

function makeFs(exists: boolean): FsProbe {
  return { exists: () => exists };
}

function allGreenEnv(overrides: Partial<DoctorEnv> = {}): DoctorEnv {
  return {
    nodeVersion: "v20.10.0",
    homeDir: "/tmp/fake-home",
    run: makeRunner({
      pnpm: { stdout: "9.0.0\n" },
      git: { stdout: "git version 2.43.0\n" },
      gh: { stdout: "gh version 2.40.0\n" },
      claude: { stdout: "claude 0.1.0\n" },
      codex: { stdout: "codex 0.2.0\n" },
    }),
    fs: makeFs(true),
    ...overrides,
  };
}

describe("parseNodeMajor", () => {
  it("extracts the major version from a v-prefixed string", () => {
    expect(parseNodeMajor("v20.10.0")).toBe(20);
    expect(parseNodeMajor("v22.1.0")).toBe(22);
  });

  it("accepts non-v-prefixed strings", () => {
    expect(parseNodeMajor("18.19.0")).toBe(18);
  });

  it("returns 0 when the string cannot be parsed", () => {
    expect(parseNodeMajor("not-a-version")).toBe(0);
  });
});

describe("runChecks — happy path", () => {
  it("returns 8 checks, all ok when everything is available", async () => {
    const env = allGreenEnv();
    // `git rev-parse` has to succeed with stdout=true; layer that stub on top.
    env.run = makeRunner({
      pnpm: { stdout: "9.0.0" },
      git: { stdout: "git version 2.43.0" },
      gh: { stdout: "gh version 2.40.0" },
      claude: { stdout: "claude 0.1.0" },
      codex: { stdout: "codex 0.2.0" },
    });
    // Wrap to handle the `git rev-parse` call too.
    const base = env.run;
    env.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return base(cmd, args, opts);
    };

    const results = await runChecks(env);
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(exitCodeFor(results)).toBe(0);
  });
});

describe("runChecks — failures and warnings", () => {
  it("flags old Node.js as a critical fail", async () => {
    const env = allGreenEnv({ nodeVersion: "v18.19.0" });
    env.run = async (cmd, args) => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const results = await runChecks(env);
    const node = results.find((r) => r.label.startsWith("Node.js"))!;
    expect(node.status).toBe("fail");
    expect(node.critical).toBe(true);
    expect(exitCodeFor(results)).toBe(1);
  });

  it("treats missing optional CLIs as warnings, not failures", async () => {
    const env = allGreenEnv();
    env.run = makeRunner({
      pnpm: { stdout: "9.0.0" },
      git: { stdout: "git version 2.43.0" },
      gh: { stdout: "gh version 2.40.0" },
      // claude + codex missing
    });
    const base = env.run;
    env.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return base(cmd, args, opts);
    };

    const results = await runChecks(env);
    const claude = results.find((r) => r.label.includes("claude"))!;
    const codex = results.find((r) => r.label.includes("codex"))!;
    expect(claude.status).toBe("warn");
    expect(claude.critical).toBe(false);
    expect(codex.status).toBe("warn");
    expect(codex.critical).toBe(false);
    // The exit code still reflects only critical failures.
    expect(exitCodeFor(results)).toBe(0);
  });

  it("flags missing pnpm as a critical fail", async () => {
    const env = allGreenEnv();
    env.run = makeRunner({
      git: { stdout: "git version 2.43.0" },
      gh: { stdout: "gh version 2.40.0" },
      claude: { stdout: "claude 0.1.0" },
      codex: { stdout: "codex 0.2.0" },
    });
    const base = env.run;
    env.run = async (cmd, args, opts) => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return base(cmd, args, opts);
    };
    const results = await runChecks(env);
    const pnpm = results.find((r) => r.label.includes("pnpm"))!;
    expect(pnpm.status).toBe("fail");
    expect(exitCodeFor(results)).toBe(1);
  });

  it("flags being outside a git repo as a critical fail", async () => {
    const env = allGreenEnv();
    env.run = async (cmd, args) => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { exitCode: 128, stdout: "", stderr: "fatal: not a git repo" };
      }
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const results = await runChecks(env);
    const repo = results.find((r) => r.label.includes("git repo"))!;
    expect(repo.status).toBe("fail");
    expect(exitCodeFor(results)).toBe(1);
  });

  it("reports a missing ~/.quorum dir as NOT YET INITIALIZED (warn, not fail)", async () => {
    const env = allGreenEnv({ fs: makeFs(false) });
    env.run = async (cmd, args) => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "ok", stderr: "" };
    };
    const results = await runChecks(env);
    const state = results.find((r) => r.label.includes(".quorum"))!;
    expect(state.status).toBe("warn");
    expect(state.message).toMatch(/NOT YET INITIALIZED/);
    expect(exitCodeFor(results)).toBe(0);
  });
});

describe("formatReport", () => {
  it("prefixes each check, ends with a success summary when all critical passed", () => {
    const results: CheckResult[] = [
      {
        label: "A",
        message: "fine",
        status: "ok",
        critical: true,
      },
      {
        label: "B",
        message: "optional missing",
        status: "warn",
        critical: false,
      },
    ];
    const out = formatReport(results);
    expect(out).toContain("\u2705 A: fine");
    expect(out).toContain("\u26a0\ufe0f B: optional missing");
    expect(out).toMatch(/All critical checks passed$/);
  });

  it("includes the count of failed critical checks in the summary", () => {
    const results: CheckResult[] = [
      { label: "A", message: "broken", status: "fail", critical: true },
      { label: "B", message: "also broken", status: "fail", critical: true },
      { label: "C", message: "fine", status: "ok", critical: true },
    ];
    const out = formatReport(results);
    expect(out).toContain("\u274c A: broken");
    expect(out).toMatch(/2 critical checks failed$/);
  });
});

describe("runDoctor", () => {
  it("returns exit code 0 and logs a report when all critical checks pass", async () => {
    const logs: string[] = [];
    const env = allGreenEnv();
    env.run = async (cmd, args) => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "1.0.0", stderr: "" };
    };
    const code = await runDoctor({ env, log: (m) => logs.push(m) });
    expect(code).toBe(0);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/All critical checks passed$/);
  });

  it("returns exit code 1 when a critical check fails", async () => {
    const logs: string[] = [];
    const env = allGreenEnv({ nodeVersion: "v18.0.0" });
    env.run = async (cmd, args) => {
      if (cmd === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: "true\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "1.0.0", stderr: "" };
    };
    const code = await runDoctor({ env, log: (m) => logs.push(m) });
    expect(code).toBe(1);
    expect(logs[0]).toMatch(/critical checks failed/);
  });
});
