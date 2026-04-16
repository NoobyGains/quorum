import { describe, it, expect } from "vitest";
import { ARTIFACT_PACKAGE_VERSION } from "./index.js";

describe("@quorum/artifacts", () => {
  it("exports a version string", () => {
    expect(ARTIFACT_PACKAGE_VERSION).toBe("0.0.0");
  });
});
