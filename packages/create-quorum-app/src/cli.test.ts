import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli.js";
import type { CliOptions } from "./types.js";

let sandbox: string;
let templatesDir: string;
let cwd: string;

function buildSyntheticTemplates(root: string): void {
  const nextjs = join(root, "nextjs");
  mkdirSync(join(nextjs, "app"), { recursive: true });
  writeFileSync(
    join(nextjs, "package.json"),
    `{"name":"__APP_NAME__","version":"0.0.0"}`,
  );
  writeFileSync(join(nextjs, "app", "page.tsx"), "hello");
}

interface Capture {
  outs: string[];
  errs: string[];
}

function makeOpts(
  args: readonly string[],
  run: CliOptions["run"],
  capture: Capture,
  overrides: Partial<CliOptions> = {},
): CliOptions {
  return {
    args,
    cwd,
    templatesDir,
    stdout: (s) => capture.outs.push(s),
    stderr: (s) => capture.errs.push(s),
    run,
    ...overrides,
  };
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "quorum-cli-test-"));
  templatesDir = join(sandbox, "templates");
  cwd = join(sandbox, "work");
  mkdirSync(cwd, { recursive: true });
  buildSyntheticTemplates(templatesDir);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("runCli — arg count validation", () => {
  it("returns 2 and prints usage when no args are given", async () => {
    const capture: Capture = { outs: [], errs: [] };
    const code = await runCli(
      makeOpts([], async () => 0, capture),
    );
    expect(code).toBe(2);
    const joinedErr = capture.errs.join("\n");
    expect(joinedErr).toContain("Usage: create-quorum-app <app-name>");
  });

  it("returns 2 and mentions arg count when given two args", async () => {
    const capture: Capture = { outs: [], errs: [] };
    const code = await runCli(
      makeOpts(["one", "two"], async () => 0, capture),
    );
    expect(code).toBe(2);
    const joinedErr = capture.errs.join("\n").toLowerCase();
    expect(joinedErr).toMatch(/arg/);
  });
});

describe("runCli — app name validation", () => {
  it("rejects a path-escape name like ../escape", async () => {
    const capture: Capture = { outs: [], errs: [] };
    const code = await runCli(
      makeOpts(["../escape"], async () => 0, capture),
    );
    expect(code).toBe(2);
    expect(capture.errs.join("\n")).toContain("invalid app name");
  });

  it("rejects a name with a space", async () => {
    const capture: Capture = { outs: [], errs: [] };
    const code = await runCli(
      makeOpts(["Bad Name"], async () => 0, capture),
    );
    expect(code).toBe(2);
    expect(capture.errs.join("\n")).toContain("invalid app name");
  });

  it("rejects an empty-string name", async () => {
    const capture: Capture = { outs: [], errs: [] };
    const code = await runCli(
      makeOpts([""], async () => 0, capture),
    );
    expect(code).toBe(2);
    expect(capture.errs.join("\n")).toContain("invalid app name");
  });

  it("rejects an excessively long name", async () => {
    const capture: Capture = { outs: [], errs: [] };
    const code = await runCli(
      makeOpts(["a".repeat(100)], async () => 0, capture),
    );
    expect(code).toBe(2);
    expect(capture.errs.join("\n")).toContain("invalid app name");
  });
});

describe("runCli — happy path", () => {
  it("returns 0 and prints the full success banner when scaffold + git init succeed", async () => {
    const capture: Capture = { outs: [], errs: [] };
    const code = await runCli(
      makeOpts(["my-app"], async () => 0, capture),
    );
    expect(code).toBe(0);
    const joinedOut = capture.outs.join("\n");
    expect(joinedOut).toContain("Created");
    expect(joinedOut).toContain("Initialized git repo");
    expect(joinedOut).toContain("Next steps:");
    expect(joinedOut).toContain("cd ");
    expect(joinedOut).toContain("pnpm install");
    expect(joinedOut).toContain("quorum install");
    expect(joinedOut).toContain("pnpm dev");
  });
});

describe("runCli — git-init failure is non-fatal", () => {
  it("returns 0, still prints Created, omits Initialized git repo, and logs git init failed on stderr", async () => {
    const capture: Capture = { outs: [], errs: [] };
    const code = await runCli(
      makeOpts(["my-app"], async () => 1, capture),
    );
    expect(code).toBe(0);
    const joinedOut = capture.outs.join("\n");
    expect(joinedOut).toContain("Created");
    expect(joinedOut).not.toContain("Initialized git repo");
    expect(capture.errs.join("\n")).toContain("git init failed");
  });
});

describe("runCli — scaffold failure", () => {
  it("returns 1 and surfaces the error message on stderr when the template is missing", async () => {
    const capture: Capture = { outs: [], errs: [] };
    // Point templatesDir at a location with no `nextjs/` subdir.
    const emptyTemplates = join(sandbox, "no-templates");
    mkdirSync(emptyTemplates, { recursive: true });
    const code = await runCli(
      makeOpts(["my-app"], async () => 0, capture, {
        templatesDir: emptyTemplates,
      }),
    );
    expect(code).toBe(1);
    expect(capture.errs.join("\n").length).toBeGreaterThan(0);
  });

  it("returns 1 when target dir already exists and is non-empty", async () => {
    const capture: Capture = { outs: [], errs: [] };
    const collision = join(cwd, "my-app");
    mkdirSync(collision, { recursive: true });
    writeFileSync(join(collision, "preexisting.txt"), "hi");

    const code = await runCli(
      makeOpts(["my-app"], async () => 0, capture),
    );
    expect(code).toBe(1);
    const joinedErr = capture.errs.join("\n");
    expect(joinedErr.length).toBeGreaterThan(0);
  });
});
