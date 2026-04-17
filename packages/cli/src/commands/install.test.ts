import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

import {
  removeClaudeHook,
  removeClaudeMcp,
  removeCodexMcp,
  runInstall,
  upsertClaudeHook,
  upsertClaudeMcp,
  upsertCodexMcp,
} from "./install.js";

// ---------- pure string transformers ---------------------------------------

describe("upsertClaudeMcp", () => {
  it("creates mcpServers.quorum in an empty document", () => {
    const out = upsertClaudeMcp("{}", "/abs/path/index.js");
    const parsed = JSON.parse(out) as {
      mcpServers: { quorum: { command: string; args: string[] } };
    };
    expect(parsed.mcpServers.quorum.command).toBe("node");
    expect(parsed.mcpServers.quorum.args).toEqual(["/abs/path/index.js"]);
  });

  it("normalizes Windows backslashes to forward slashes in the args", () => {
    const out = upsertClaudeMcp("{}", "C:\\repo\\mcp-server\\dist\\index.js");
    const parsed = JSON.parse(out) as {
      mcpServers: { quorum: { args: string[] } };
    };
    expect(parsed.mcpServers.quorum.args[0]).toBe(
      "C:/repo/mcp-server/dist/index.js",
    );
  });

  it("preserves unrelated mcpServers siblings", () => {
    const input = JSON.stringify({
      mcpServers: {
        other: { command: "other-tool" },
      },
      unrelatedRoot: "keep me",
    });
    const out = upsertClaudeMcp(input, "/abs/path/index.js");
    const parsed = JSON.parse(out) as {
      mcpServers: Record<string, unknown>;
      unrelatedRoot: string;
    };
    expect(parsed.mcpServers.other).toEqual({ command: "other-tool" });
    expect(parsed.mcpServers.quorum).toBeDefined();
    expect(parsed.unrelatedRoot).toBe("keep me");
  });

  it("is idempotent (applying twice equals applying once)", () => {
    const once = upsertClaudeMcp("{}", "/abs/path/index.js");
    const twice = upsertClaudeMcp(once, "/abs/path/index.js");
    expect(twice).toBe(once);
  });

  it("refreshes the args if the path changes", () => {
    const first = upsertClaudeMcp("{}", "/old/path.js");
    const updated = upsertClaudeMcp(first, "/new/path.js");
    const parsed = JSON.parse(updated) as {
      mcpServers: { quorum: { args: string[] } };
    };
    expect(parsed.mcpServers.quorum.args[0]).toBe("/new/path.js");
  });
});

describe("removeClaudeMcp", () => {
  it("removes only the quorum key", () => {
    const withBoth = upsertClaudeMcp(
      JSON.stringify({ mcpServers: { other: { command: "other" } } }),
      "/p.js",
    );
    const cleaned = removeClaudeMcp(withBoth);
    const parsed = JSON.parse(cleaned) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers.quorum).toBeUndefined();
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
  });

  it("is a no-op when there is nothing to remove", () => {
    const input = JSON.stringify(
      { mcpServers: { other: { command: "other" } } },
      null,
      2,
    );
    const cleaned = removeClaudeMcp(input + "\n");
    const parsed = JSON.parse(cleaned) as {
      mcpServers: Record<string, unknown>;
    };
    expect(parsed.mcpServers.other).toEqual({ command: "other" });
  });
});

describe("upsertClaudeHook", () => {
  it("adds a _quorumManaged UserPromptSubmit entry to an empty doc", () => {
    const out = upsertClaudeHook("{}");
    const parsed = JSON.parse(out) as {
      hooks: { UserPromptSubmit: Array<{ _quorumManaged?: boolean }> };
    };
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(1);
    expect(parsed.hooks.UserPromptSubmit[0]._quorumManaged).toBe(true);
  });

  it("is idempotent — applying twice does not duplicate the entry", () => {
    const once = upsertClaudeHook("{}");
    const twice = upsertClaudeHook(once);
    const parsed = JSON.parse(twice) as {
      hooks: { UserPromptSubmit: unknown[] };
    };
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("preserves user-authored entries on the same hook", () => {
    const userAuthored = JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [{ type: "command", command: "echo mine" }],
          },
        ],
      },
    });
    const out = upsertClaudeHook(userAuthored);
    const parsed = JSON.parse(out) as {
      hooks: { UserPromptSubmit: Array<{ _quorumManaged?: boolean }> };
    };
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(2);
    const userEntry = parsed.hooks.UserPromptSubmit.find(
      (e) => e._quorumManaged !== true,
    );
    expect(userEntry).toBeDefined();
  });
});

describe("removeClaudeHook", () => {
  it("removes only the _quorumManaged entry", () => {
    const withBoth = upsertClaudeHook(
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { hooks: [{ type: "command", command: "echo mine" }] },
          ],
        },
      }),
    );
    const cleaned = removeClaudeHook(withBoth);
    const parsed = JSON.parse(cleaned) as {
      hooks: { UserPromptSubmit: Array<{ _quorumManaged?: boolean }> };
    };
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(1);
    expect(parsed.hooks.UserPromptSubmit[0]._quorumManaged).not.toBe(true);
  });
});

describe("upsertCodexMcp", () => {
  it("writes a managed [mcp_servers.quorum] section into empty input", () => {
    const out = upsertCodexMcp("", "/abs/index.js");
    expect(out).toContain("# managed-by: quorum-install");
    expect(out).toContain("[mcp_servers.quorum]");
    expect(out).toContain('args = ["/abs/index.js"]');
  });

  it("normalizes Windows backslashes", () => {
    const out = upsertCodexMcp("", "C:\\a\\b.js");
    expect(out).toContain('args = ["C:/a/b.js"]');
  });

  it("is idempotent", () => {
    const once = upsertCodexMcp("", "/abs/index.js");
    const twice = upsertCodexMcp(once, "/abs/index.js");
    expect(twice).toBe(once);
  });

  it("preserves existing TOML content", () => {
    const existing = `[mcp_servers.other]\ncommand = "x"\n`;
    const out = upsertCodexMcp(existing, "/abs/index.js");
    expect(out).toContain("[mcp_servers.other]");
    expect(out).toContain("[mcp_servers.quorum]");
  });

  it("refreshes the path when called again with a different mcpServerPath", () => {
    const first = upsertCodexMcp("", "/old.js");
    const second = upsertCodexMcp(first, "/new.js");
    expect(second).toContain("/new.js");
    expect(second).not.toContain("/old.js");
  });
});

describe("removeCodexMcp", () => {
  it("removes the quorum section plus its managed-by marker", () => {
    const withOurs = upsertCodexMcp(
      `[mcp_servers.other]\ncommand = "x"\n`,
      "/abs/index.js",
    );
    const cleaned = removeCodexMcp(withOurs);
    expect(cleaned).not.toContain("[mcp_servers.quorum]");
    expect(cleaned).not.toContain("# managed-by: quorum-install");
    expect(cleaned).toContain("[mcp_servers.other]");
  });

  it("is a no-op for TOML without the quorum section", () => {
    const input = `[mcp_servers.other]\ncommand = "x"\n`;
    expect(removeCodexMcp(input).trim()).toBe(input.trim());
  });

  it("still removes the section if the managed-by marker comment is missing", () => {
    const withoutMarker = `[mcp_servers.quorum]\ncommand = "node"\nargs = ["/p.js"]\n`;
    expect(removeCodexMcp(withoutMarker).trim()).toBe("");
  });
});

// ---------- runInstall (integration) ---------------------------------------

describe("runInstall (integration)", () => {
  let tmpHome: string;

  const MCP_PATH = "/abs/mcp-server/dist/index.js";

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-install-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  function env() {
    return { homeDir: tmpHome, mcpServerPath: MCP_PATH };
  }

  it("creates all three target files on a first install", async () => {
    const code = await runInstall({
      env: env(),
      opts: {},
      log: () => {},
    });
    expect(code).toBe(0);
    expect(existsSync(join(tmpHome, ".claude.json"))).toBe(true);
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(tmpHome, ".codex", "config.toml"))).toBe(true);
  });

  it("dry-run does not touch the filesystem", async () => {
    const logs: string[] = [];
    const code = await runInstall({
      env: env(),
      opts: { dryRun: true },
      log: (m) => logs.push(m),
    });
    expect(code).toBe(0);
    expect(existsSync(join(tmpHome, ".claude.json"))).toBe(false);
    expect(logs.some((l) => /\[create\]|\[update\]/.test(l))).toBe(true);
  });

  it("is idempotent — running twice leaves file contents byte-equal", async () => {
    await runInstall({ env: env(), opts: {}, log: () => {} });
    const snap1 = {
      claude: readFileSync(join(tmpHome, ".claude.json"), "utf8"),
      settings: readFileSync(
        join(tmpHome, ".claude", "settings.json"),
        "utf8",
      ),
      codex: readFileSync(join(tmpHome, ".codex", "config.toml"), "utf8"),
    };
    await runInstall({ env: env(), opts: {}, log: () => {} });
    const snap2 = {
      claude: readFileSync(join(tmpHome, ".claude.json"), "utf8"),
      settings: readFileSync(
        join(tmpHome, ".claude", "settings.json"),
        "utf8",
      ),
      codex: readFileSync(join(tmpHome, ".codex", "config.toml"), "utf8"),
    };
    expect(snap2).toEqual(snap1);
  });

  it("uninstall cleanly reverses install", async () => {
    await runInstall({ env: env(), opts: {}, log: () => {} });
    await runInstall({
      env: env(),
      opts: { uninstall: true },
      log: () => {},
    });
    const claude = JSON.parse(
      readFileSync(join(tmpHome, ".claude.json"), "utf8"),
    ) as { mcpServers?: Record<string, unknown> };
    expect(claude.mcpServers?.quorum).toBeUndefined();

    const settings = JSON.parse(
      readFileSync(join(tmpHome, ".claude", "settings.json"), "utf8"),
    ) as { hooks?: { UserPromptSubmit?: Array<{ _quorumManaged?: boolean }> } };
    const managed = (settings.hooks?.UserPromptSubmit ?? []).some(
      (e) => e._quorumManaged === true,
    );
    expect(managed).toBe(false);

    const toml = readFileSync(join(tmpHome, ".codex", "config.toml"), "utf8");
    expect(toml).not.toContain("[mcp_servers.quorum]");
    expect(toml).not.toContain("# managed-by: quorum-install");
  });

  it("preserves a pre-existing unrelated MCP entry through install + uninstall", async () => {
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".claude.json"),
      JSON.stringify(
        { mcpServers: { other: { command: "other-tool" } } },
        null,
        2,
      ) + "\n",
    );
    await runInstall({ env: env(), opts: {}, log: () => {} });
    await runInstall({
      env: env(),
      opts: { uninstall: true },
      log: () => {},
    });
    const parsed = JSON.parse(
      readFileSync(join(tmpHome, ".claude.json"), "utf8"),
    ) as { mcpServers?: Record<string, unknown> };
    expect(parsed.mcpServers?.other).toEqual({ command: "other-tool" });
    expect(parsed.mcpServers?.quorum).toBeUndefined();
  });

  it("--agent claude only touches the two Claude files", async () => {
    await runInstall({
      env: env(),
      opts: { agent: "claude" },
      log: () => {},
    });
    expect(existsSync(join(tmpHome, ".claude.json"))).toBe(true);
    expect(existsSync(join(tmpHome, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(tmpHome, ".codex", "config.toml"))).toBe(false);
  });

  it("--agent codex only touches the Codex file", async () => {
    await runInstall({
      env: env(),
      opts: { agent: "codex" },
      log: () => {},
    });
    expect(existsSync(join(tmpHome, ".claude.json"))).toBe(false);
    expect(existsSync(join(tmpHome, ".codex", "config.toml"))).toBe(true);
  });

  it("reports failure on an invalid pre-existing JSON file", async () => {
    writeFileSync(join(tmpHome, ".claude.json"), "this is not json");
    const errs: string[] = [];
    const code = await runInstall({
      env: env(),
      opts: {},
      log: () => {},
      err: (m) => errs.push(m),
    });
    expect(code).toBe(1);
    expect(errs.join("\n")).toMatch(/quorum install/);
  });
});
