// Tests for the generic read/list/search tools. We seed a handful of
// artifacts via the create tools, then exercise the read/list/search paths
// over the live server.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "@quorum/store";

import { createServer } from "../server.js";

interface TextBlock {
  type: string;
  text: string;
}

async function callJson<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await client.callTool({ name, arguments: args });
  expect(res.isError, JSON.stringify(res)).toBeFalsy();
  const content = res.content as TextBlock[];
  return JSON.parse(content[0].text) as T;
}

describe("artifact.read / list / search", () => {
  let tmpHome: string;
  let store: Store;
  let client: Client;
  let close: () => Promise<void>;

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-mcp-artifact-"));
    const cwd = "/fake/project/mcp-artifact-test";
    store = new Store(cwd, { homeDir: tmpHome, warn: () => {} });
    const server = createServer({ storeFactory: () => store });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    client = new Client(
      { name: "test-client", version: "0.0.0" },
      { capabilities: {} },
    );
    await Promise.all([server.connect(st), client.connect(ct)]);
    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await close();
    try {
      await store.close();
    } catch {
      // ignore — the server's onclose already closed the store.
    }
    rmSync(tmpHome, { recursive: true, force: true });
  });

  async function seedPlan(goal: string, author = "claude"): Promise<string> {
    const body = await callJson<{ id: string }>(client, "plan.create", {
      goal,
      approach: "test approach",
      files_touched: ["file.ts"],
      assumptions: [],
      confidence: 0.5,
      blast_radius: "small",
      author,
      project: "proj",
    });
    return body.id;
  }

  it("artifact.read returns { found: false } for a missing id", async () => {
    const body = await callJson<{ found: boolean }>(client, "artifact.read", {
      id: "pln_deadbeef",
    });
    expect(body.found).toBe(false);
  });

  it("artifact.read returns the full body for a present id", async () => {
    const id = await seedPlan("throttle endpoint");
    const body = await callJson<{
      found: boolean;
      artifact: { id: string; goal: string };
    }>(client, "artifact.read", { id });
    expect(body.found).toBe(true);
    expect(body.artifact.id).toBe(id);
    expect(body.artifact.goal).toBe("throttle endpoint");
  });

  it("artifact.list filters by type and author", async () => {
    await seedPlan("alpha");
    await seedPlan("beta", "codex");
    await seedPlan("gamma");

    const all = await callJson<{ count: number }>(client, "artifact.list", {});
    expect(all.count).toBe(3);

    const onlyPlans = await callJson<{ count: number }>(
      client,
      "artifact.list",
      { type: "Plan" },
    );
    expect(onlyPlans.count).toBe(3);

    const byCodex = await callJson<{
      count: number;
      artifacts: { author: string }[];
    }>(client, "artifact.list", { author: "codex" });
    expect(byCodex.count).toBe(1);
    expect(byCodex.artifacts[0].author).toBe("codex");

    // Non-existent type filter (valid enum value, no matching artifact) —
    // 'Claim' was never seeded.
    const noClaims = await callJson<{ count: number }>(
      client,
      "artifact.list",
      { type: "Claim" },
    );
    expect(noClaims.count).toBe(0);
  });

  it("artifact.list rejects an invalid type enum with isError", async () => {
    const res = await client.callTool({
      name: "artifact.list",
      arguments: { type: "NotAnArtifactType" },
    });
    expect(res.isError).toBe(true);
  });

  it("artifact.search finds hits via FTS5 and respects limit", async () => {
    await seedPlan("throttle endpoint x");
    await seedPlan("throttle endpoint y");
    await seedPlan("migrate db schema");

    const hits = await callJson<{
      count: number;
      artifacts: { id: string }[];
    }>(client, "artifact.search", { query: "throttle" });
    expect(hits.count).toBe(2);

    const limited = await callJson<{ count: number }>(
      client,
      "artifact.search",
      { query: "throttle", limit: 1 },
    );
    expect(limited.count).toBe(1);
  });
});
