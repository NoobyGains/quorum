import { describe, it, expect } from "vitest";
import { MCP_SERVER_VERSION } from "./index.js";

describe("@quorum/mcp-server", () => {
  it("exports a version string", () => {
    expect(MCP_SERVER_VERSION).toBe("0.0.0");
  });
});
