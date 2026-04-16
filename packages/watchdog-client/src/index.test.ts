import { describe, it, expect } from "vitest";
import { WATCHDOG_CLIENT_VERSION } from "./index.js";

describe("@quorum/watchdog-client", () => {
  it("exports a version string", () => {
    expect(WATCHDOG_CLIENT_VERSION).toBe("0.0.0");
  });
});
