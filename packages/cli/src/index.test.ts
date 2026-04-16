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

  it("registers the 'inbox' and 'presence' subcommands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toContain("inbox");
    expect(names).toContain("presence");
  });

  it("--help output lists all registered subcommands", () => {
    const program = buildProgram();
    // `helpInformation()` returns the text that `--help` would print.
    const help = program.helpInformation();
    expect(help).toMatch(/\bdoctor\b/);
    expect(help).toMatch(/\binit\b/);
    expect(help).toMatch(/\binbox\b/);
    expect(help).toMatch(/\bpresence\b/);
  });

  it("inbox subcommand advertises its flags", () => {
    const program = buildProgram();
    const inbox = program.commands.find((c) => c.name() === "inbox");
    expect(inbox).toBeDefined();
    const help = inbox?.helpInformation() ?? "";
    expect(help).toMatch(/--agent/);
    expect(help).toMatch(/--unread/);
    expect(help).toMatch(/--since/);
    expect(help).toMatch(/--json/);
  });

  it("presence subcommand advertises its flags", () => {
    const program = buildProgram();
    const presence = program.commands.find((c) => c.name() === "presence");
    expect(presence).toBeDefined();
    const help = presence?.helpInformation() ?? "";
    expect(help).toMatch(/--json/);
  });

  it("reports the CLI version via commander", () => {
    const program = buildProgram();
    expect(program.version()).toBe(CLI_VERSION);
  });
});
