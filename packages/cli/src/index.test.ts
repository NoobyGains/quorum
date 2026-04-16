import { describe, it, expect } from "vitest";
import { buildProgram, CLI_VERSION } from "./index.js";

describe("@quorum/cli", () => {
  it("exports a version string", () => {
    expect(CLI_VERSION).toBe("0.0.0");
  });

  it("builds a commander program named 'quorum'", () => {
    const program = buildProgram();
    expect(program.name()).toBe("quorum");
  });

  it("registers 'doctor' and 'init' subcommands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toContain("doctor");
    expect(names).toContain("init");
  });

  it("--help output lists both subcommands", () => {
    const program = buildProgram();
    // `helpInformation()` returns the text that `--help` would print.
    const help = program.helpInformation();
    expect(help).toMatch(/\bdoctor\b/);
    expect(help).toMatch(/\binit\b/);
  });

  it("reports the CLI version via commander", () => {
    const program = buildProgram();
    expect(program.version()).toBe(CLI_VERSION);
  });
});
