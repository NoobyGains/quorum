import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffold } from "./scaffold.js";

let sandbox: string;
let templateDir: string;
let targetDir: string;

function buildSyntheticTemplate(root: string): void {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "src", "nested"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `{"name":"__APP_NAME__","version":"0.0.0"}`,
  );
  writeFileSync(
    join(root, "src", "index.ts"),
    `// __APP_NAME__ stays here`,
  );
  writeFileSync(join(root, "src", "nested", "hello.txt"), "hello");
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "quorum-scaffold-test-"));
  templateDir = join(sandbox, "template");
  targetDir = join(sandbox, "target");
  buildSyntheticTemplate(templateDir);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("scaffold — happy path", () => {
  it("copies every template file into a missing target dir and returns sorted POSIX paths", async () => {
    const result = await scaffold({
      targetDir,
      appName: "my-app",
      templateDir,
    });

    expect(existsSync(targetDir)).toBe(true);
    expect(existsSync(join(targetDir, "package.json"))).toBe(true);
    expect(existsSync(join(targetDir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(targetDir, "src", "nested", "hello.txt"))).toBe(
      true,
    );
    expect(result.createdFiles).toEqual([
      "package.json",
      "src/index.ts",
      "src/nested/hello.txt",
    ]);
  });
});

describe("scaffold — package.json substitution", () => {
  it("replaces every literal __APP_NAME__ in package.json with opts.appName", async () => {
    writeFileSync(
      join(templateDir, "package.json"),
      `{"name":"__APP_NAME__","description":"the __APP_NAME__ project"}`,
    );
    await scaffold({
      targetDir,
      appName: "my-app",
      templateDir,
    });
    const pkg = readFileSync(join(targetDir, "package.json"), "utf8");
    expect(pkg).toBe(`{"name":"my-app","description":"the my-app project"}`);
    expect(pkg).not.toContain("__APP_NAME__");
  });
});

describe("scaffold — overwrite semantics", () => {
  it("rejects when target dir is non-empty and overwrite is not set", async () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "preexisting.txt"), "hi");

    await expect(
      scaffold({ targetDir, appName: "my-app", templateDir }),
    ).rejects.toThrow(/target directory is not empty/);
  });

  it("succeeds when target dir is non-empty and overwrite is true", async () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "preexisting.txt"), "hi");

    const result = await scaffold({
      targetDir,
      appName: "my-app",
      templateDir,
      overwrite: true,
    });
    expect(result.createdFiles).toContain("package.json");
    expect(existsSync(join(targetDir, "package.json"))).toBe(true);
  });

  it("succeeds without overwrite when target dir exists but is empty", async () => {
    mkdirSync(targetDir, { recursive: true });

    const result = await scaffold({
      targetDir,
      appName: "my-app",
      templateDir,
    });
    expect(result.createdFiles).toContain("package.json");
  });
});

describe("scaffold — missing template", () => {
  it("rejects when template dir does not exist", async () => {
    const missing = join(sandbox, "does-not-exist");
    await expect(
      scaffold({ targetDir, appName: "my-app", templateDir: missing }),
    ).rejects.toThrow(/template directory is empty or missing/);
  });

  it("rejects when template dir exists but is empty", async () => {
    const empty = join(sandbox, "empty-template");
    mkdirSync(empty, { recursive: true });
    await expect(
      scaffold({ targetDir, appName: "my-app", templateDir: empty }),
    ).rejects.toThrow(/template directory is empty or missing/);
  });
});

describe("scaffold — appName validation", () => {
  it("rejects empty appName", async () => {
    await expect(
      scaffold({ targetDir, appName: "", templateDir }),
    ).rejects.toThrow(/invalid appName/);
  });

  it("rejects appName containing ..", async () => {
    await expect(
      scaffold({ targetDir, appName: "../evil", templateDir }),
    ).rejects.toThrow(/invalid appName/);
  });

  it("rejects appName containing forward slash", async () => {
    await expect(
      scaffold({ targetDir, appName: "foo/bar", templateDir }),
    ).rejects.toThrow(/invalid appName/);
  });

  it("rejects appName containing backslash", async () => {
    await expect(
      scaffold({ targetDir, appName: "foo\\bar", templateDir }),
    ).rejects.toThrow(/invalid appName/);
  });
});

describe("scaffold — nested directory preservation", () => {
  it("preserves nested directory structure in the target", async () => {
    mkdirSync(join(templateDir, "a", "b", "c"), { recursive: true });
    writeFileSync(join(templateDir, "a", "b", "c", "deep.txt"), "deep");

    const result = await scaffold({
      targetDir,
      appName: "my-app",
      templateDir,
    });

    expect(existsSync(join(targetDir, "a", "b", "c", "deep.txt"))).toBe(true);
    expect(readFileSync(join(targetDir, "a", "b", "c", "deep.txt"), "utf8")).toBe(
      "deep",
    );
    expect(result.createdFiles).toContain("a/b/c/deep.txt");
  });
});

describe("scaffold — substitution only applies to package.json", () => {
  it("does not substitute __APP_NAME__ in non-package.json files", async () => {
    await scaffold({
      targetDir,
      appName: "my-app",
      templateDir,
    });
    const src = readFileSync(join(targetDir, "src", "index.ts"), "utf8");
    expect(src).toBe("// __APP_NAME__ stays here");
    const hello = readFileSync(
      join(targetDir, "src", "nested", "hello.txt"),
      "utf8",
    );
    expect(hello).toBe("hello");
  });
});

describe("scaffold — createdFiles path format", () => {
  it("returns forward-slash POSIX paths even for nested files", async () => {
    const result = await scaffold({
      targetDir,
      appName: "my-app",
      templateDir,
    });
    for (const p of result.createdFiles) {
      expect(p.includes("\\")).toBe(false);
    }
    expect(result.createdFiles).toEqual([...result.createdFiles].sort());
  });
});
