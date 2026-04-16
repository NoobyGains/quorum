import { describe, it, expect } from "vitest";
import { CLI_VERSION } from "./index.js";

describe("@quorum/cli", () => {
  it("exports a version string", () => {
    expect(CLI_VERSION).toBe("0.0.0");
  });
});
