// Aggregate create-tool tests.
//
// One iteration over every create tool exercises:
//   - successful create + artifact.read round-trip
//   - validation failure when a required field is missing
//   - (per-tool) missing 'author' is rejected (shared failure mode)
//
// Rather than copy-pasting per tool, we drive the list from a fixture
// map keyed by tool name.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClaim, createPlan } from "@quorum/artifacts";
import { Store } from "@quorum/store";

import { createServer } from "../server.js";

interface ToolFixture {
  /** Valid args that should successfully create an artifact. */
  valid: Record<string, unknown>;
  /** Expected id prefix (before the underscore). */
  idPrefix: string;
  /** One field to omit from `valid` to force a validation failure. */
  requiredField: string;
}

// Per-tool minimal-but-valid fixtures. We share `author` and `project`
// across all of them so the create-tools array can be walked once.
const BASE = {
  author: "claude",
  project: "quorum-test",
};

const FIXTURES: Record<string, ToolFixture> = {
  "plan.create": {
    valid: {
      ...BASE,
      goal: "ship Wave 3",
      approach: "land CRUD tools",
      files_touched: ["packages/mcp-server/src/tools/"],
      assumptions: ["store is stable"],
      confidence: 0.8,
      blast_radius: "small",
    },
    idPrefix: "pln",
    requiredField: "goal",
  },
  "claim.create": {
    valid: {
      ...BASE,
      target: "issue:#25",
      agent: "claude",
      exclusive: true,
      ttl_seconds: 3600,
      reason: "active work",
    },
    idPrefix: "clm",
    requiredField: "target",
  },
  "hypothesis.create": {
    valid: {
      ...BASE,
      statement: "FTS5 is sufficient for body search",
      evidence_for: ["tested in store"],
      evidence_against: [],
      confidence: 0.7,
    },
    idPrefix: "hyp",
    requiredField: "statement",
  },
  "experiment.create": {
    valid: {
      ...BASE,
      hypothesis_id: "hyp_12345678",
      method: "write then search",
      expected: "hit within 50ms",
    },
    idPrefix: "exp",
    requiredField: "method",
  },
  "result.create": {
    valid: {
      ...BASE,
      experiment_id: "exp_12345678",
      observed: "hit in 12ms",
      surprised_me: false,
    },
    idPrefix: "res",
    requiredField: "experiment_id",
  },
  "decision.create": {
    valid: {
      ...BASE,
      question: "index now or later?",
      options: ["now", "later"],
      chosen: "now",
      rationale: "blocking downstream",
      signed_by: ["claude", "codex"],
    },
    idPrefix: "dcs",
    requiredField: "chosen",
  },
  "question.create": {
    valid: {
      ...BASE,
      text: "should we ship?",
      blocking: true,
      addressed_to: ["david"],
    },
    idPrefix: "qst",
    requiredField: "text",
  },
  "commitment.create": {
    valid: {
      ...BASE,
      what: "review PR #25",
      by_when: new Date(Date.now() + 3_600_000).toISOString(),
      to_whom: ["david"],
    },
    idPrefix: "cmt",
    requiredField: "what",
  },
  "disagreement.create": {
    valid: {
      ...BASE,
      target: "pln_abc12345",
      thesis_agent: "claude",
      thesis: "land as-is",
      antithesis_agent: "codex",
      antithesis: "needs refactor",
      evidence: ["test coverage"],
      severity: "advisory",
    },
    idPrefix: "dsg",
    requiredField: "thesis",
  },
  "handoff.create": {
    valid: {
      ...BASE,
      from: "claude",
      summary: "wave 3 done",
      open_questions: [],
      confidence_drift: 0.1,
    },
    idPrefix: "hnd",
    requiredField: "summary",
  },
  "review.create": {
    valid: {
      ...BASE,
      target_commit: "abcdef1234567",
      target_plan: "pln_seeded",
      reviewer: "codex",
      verdict: "approve",
      notes: [],
    },
    idPrefix: "rev",
    requiredField: "reviewer",
  },
  "risk_flag.create": {
    valid: {
      ...BASE,
      target: "pln_abc12345",
      severity: "medium",
      category: "security",
      description: "unauthenticated endpoint",
      mitigation: "add auth middleware",
    },
    idPrefix: "rsk",
    requiredField: "description",
  },
};

async function connectClient(
  factory: () => Store,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createServer({ storeFactory: factory });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

describe("create tools", () => {
  let tmpHome: string;
  let store: Store;
  let client: Client;
  let disconnect: () => Promise<void>;

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), "quorum-mcp-create-"));
    const cwd = "/fake/project/mcp-create-test";
    // We need the same Store backing both the server handlers (via the
    // factory) and our direct verification reads. Construct one shared
    // instance and return it from the factory; dispose at teardown.
    store = new Store(cwd, { homeDir: tmpHome });

    // Seed a Plan that the review.create fixture references. This is the
    // target_plan every review in the generic loop and the positive-path
    // tests below will point at. Rejection paths use a different id.
    await store.write(
      createPlan({
        id: "pln_seeded",
        author: "claude",
        project: "quorum-test",
        goal: "seeded plan for review tests",
        approach: "n/a",
        files_touched: [],
        assumptions: [],
        confidence: 0.5,
        blast_radius: "small",
        estimated_tokens: 0,
        risk_flags: [],
        status: "objection_window",
      }),
    );

    const connected = await connectClient(() => store);
    client = connected.client;
    disconnect = connected.close;
  });

  afterEach(async () => {
    await disconnect();
    // The server's onclose closes the injected store too; calling close
    // twice on better-sqlite3 is a noop-or-throw depending on version, so
    // guard it.
    try {
      await store.close();
    } catch {
      // already closed by the server's onclose hook — fine.
    }
    rmSync(tmpHome, { recursive: true, force: true });
  });

  for (const [toolName, fx] of Object.entries(FIXTURES)) {
    describe(toolName, () => {
      it("creates, returns an id with the right prefix, and round-trips through artifact.read", async () => {
        const res = await client.callTool({
          name: toolName,
          arguments: fx.valid,
        });
        expect(res.isError).toBeFalsy();
        const content = res.content as { type: string; text: string }[];
        expect(content?.[0]?.type).toBe("text");
        const body = JSON.parse(content[0].text) as {
          id: string;
          type: string;
        };
        expect(body.id.startsWith(`${fx.idPrefix}_`)).toBe(true);

        const readRes = await client.callTool({
          name: "artifact.read",
          arguments: { id: body.id },
        });
        expect(readRes.isError).toBeFalsy();
        const readContent = readRes.content as { text: string }[];
        const parsed = JSON.parse(readContent[0].text) as {
          found: boolean;
          artifact: { id: string; type: string; author: string };
        };
        expect(parsed.found).toBe(true);
        expect(parsed.artifact.id).toBe(body.id);
        expect(parsed.artifact.author).toBe(BASE.author);
      });

      it("returns an isError when the required field is missing", async () => {
        const bad: Record<string, unknown> = { ...fx.valid };
        delete bad[fx.requiredField];
        const res = await client.callTool({
          name: toolName,
          arguments: bad,
        });
        expect(res.isError).toBe(true);
      });
    });
  }

  it("rejects unknown tool names with isError", async () => {
    const res = await client.callTool({
      name: "nonexistent.create",
      arguments: {},
    });
    expect(res.isError).toBe(true);
  });

  // Regression #54: review.create used to fabricate target_plan to satisfy
  // the ReviewSchema when the caller omitted it. It must instead reject.
  describe("review.create target_plan validation", () => {
    const reviewArgs = {
      ...BASE,
      target_commit: "abcdef1234567",
      reviewer: "codex",
      verdict: "approve",
      notes: [],
    };

    it("rejects when target_plan is omitted", async () => {
      const res = await client.callTool({
        name: "review.create",
        arguments: reviewArgs,
      });
      expect(res.isError).toBe(true);
    });

    it("rejects when target_plan does not resolve to an existing artifact", async () => {
      const res = await client.callTool({
        name: "review.create",
        arguments: { ...reviewArgs, target_plan: "pln_doesnotexist" },
      });
      expect(res.isError).toBe(true);
      const text = (res.content as { text: string }[])[0].text;
      expect(text).toMatch(/target_plan/i);
    });

    it("rejects when target_plan points to a non-Plan artifact", async () => {
      await store.write(
        createClaim({
          id: "clm_notaplan",
          author: "claude",
          project: "quorum-test",
          target: "issue:#999",
          agent: "claude",
          exclusive: true,
          ttl_seconds: 60,
          reason: "test",
        }),
      );
      const res = await client.callTool({
        name: "review.create",
        arguments: { ...reviewArgs, target_plan: "clm_notaplan" },
      });
      expect(res.isError).toBe(true);
      const text = (res.content as { text: string }[])[0].text;
      expect(text).toMatch(/Plan/);
    });
  });
});
