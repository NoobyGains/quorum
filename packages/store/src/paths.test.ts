import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalizeProjectPath, projectHash, storageRoot } from "./paths.js";

describe("canonicalizeProjectPath (pure)", () => {
  it("strips a trailing separator", () => {
    expect(canonicalizeProjectPath("/proj/x/")).toBe(
      canonicalizeProjectPath("/proj/x"),
    );
  });

  it("treats backslashes and forward slashes as equivalent", () => {
    expect(canonicalizeProjectPath("C:\\proj\\x")).toBe(
      canonicalizeProjectPath("C:/proj/x"),
    );
  });

  it("lowercases the drive letter on Windows-style absolute paths", () => {
    expect(canonicalizeProjectPath("C:/proj/x")).toBe(
      canonicalizeProjectPath("c:/proj/x"),
    );
  });

  it("is idempotent", () => {
    const once = canonicalizeProjectPath("/proj/x/");
    expect(canonicalizeProjectPath(once)).toBe(once);
  });
});

describe("projectHash", () => {
  it("is a stable 16-char lowercase hex digest", () => {
    const h = projectHash("/some/project");
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(projectHash("/some/project")).toBe(h);
  });

  it("produces different hashes for genuinely different paths", () => {
    expect(projectHash("/a")).not.toBe(projectHash("/b"));
  });

  it("ignores trailing-slash variants", () => {
    expect(projectHash("/proj/x/")).toBe(projectHash("/proj/x"));
  });

  it("ignores drive-letter casing", () => {
    expect(projectHash("C:/proj/x")).toBe(projectHash("c:/proj/x"));
  });

  it("ignores separator style on Windows-like paths", () => {
    expect(projectHash("C:\\proj\\x")).toBe(projectHash("C:/proj/x"));
  });
});

describe("projectHash — realpath (symlink) normalization", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "quorum-paths-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves a symlink to the same hash as the real directory", () => {
    const real = join(tmpDir, "real");
    const link = join(tmpDir, "link");
    mkdirSync(real);
    // On Windows, non-admin users can't create directory symlinks. Use
    // 'junction' which doesn't require elevation; on POSIX, 'dir' is fine.
    const linkType = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(real, link, linkType);

    expect(projectHash(link)).toBe(projectHash(real));
  });
});

describe("storageRoot uses the canonicalized hash", () => {
  it("gives the same state dir regardless of input path variant", () => {
    const home = "/home/me";
    expect(storageRoot("/proj/x/", home)).toBe(storageRoot("/proj/x", home));
  });
});
