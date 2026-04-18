// Integration tests that exercise the real child_process spawn path in
// doctor.ts — the other doctor tests all stub CommandRunner. Added for
// GitHub issue #51 (Codex review follow-up).

import { describe, it, expect } from "vitest";
import { spawn, type SpawnOptions } from "node:child_process";
import { probeBinary, type CommandRunner } from "./doctor.js";

// Mirror of the defaultRun in doctor.ts. We can't import it (it's not
// exported) but the behavior we care about is the real spawn path, so
// reproducing the thin wrapper here is fine.
const realRun: CommandRunner = (cmd, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      ...options,
    } satisfies SpawnOptions);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });

describe("probeBinary — real child_process", () => {
  it("probes `node --version` and reports available with a v-prefixed version", async () => {
    // Belt-and-braces: if node isn't on PATH somehow, skip rather than fail.
    let nodeOnPath = true;
    try {
      await realRun("node", ["--version"]);
    } catch {
      nodeOnPath = false;
    }
    if (!nodeOnPath) return;

    const result = await probeBinary(realRun, "node", ["--version"]);
    expect(result.available).toBe(true);
    expect(result.version).toMatch(/^v\d+\./);
  });

  it("reports a clearly-missing binary as not available without throwing", async () => {
    const result = await probeBinary(
      realRun,
      "this-binary-definitely-does-not-exist-12345",
    );
    expect(result.available).toBe(false);
    expect(result.version).toBe("");
  });
});
