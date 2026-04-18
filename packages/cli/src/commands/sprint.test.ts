import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Plan, Decision } from "@quorum/artifacts";

import {
  defaultTasksFromGoal,
  loadTasksFromFile,
  makeMockWorker,
  notImplementedWorker,
  runSprint,
  type SprintOptions,
  type SprintStore,
  type SprintTask,
  type Worker,
} from "./sprint.js";

function makeStore(): SprintStore & { written: Array<Plan | Decision> } {
  const written: Array<Plan | Decision> = [];
  return {
    written,
    async write(a) {
      written.push(a);
    },
  };
}

interface Capture {
  outs: string[];
  errs: string[];
}

interface TestBundle {
  opts: SprintOptions;
  capture: Capture;
  /** The live mock store. `null` when the caller passed `store: null` in overrides. */
  store: ReturnType<typeof makeStore> | null;
}

function makeOpts(overrides: Partial<SprintOptions> = {}): TestBundle {
  const capture: Capture = { outs: [], errs: [] };
  // If caller passed an explicit `store: null`, honor that; otherwise give
  // them a fresh mock store.
  const hasStoreOverride = "store" in overrides;
  const testStore: ReturnType<typeof makeStore> | null = hasStoreOverride
    ? null
    : makeStore();
  const now = () => new Date("2026-04-17T23:00:00.000Z");
  const opts: SprintOptions = {
    goal: "test goal",
    tasks: [
      { id: "t1", prompt: "task 1" },
      { id: "t2", prompt: "task 2" },
    ],
    maxAgents: 2,
    budgetUsd: 10,
    dryRun: false,
    worker: makeMockWorker(),
    store: testStore,
    stdout: (m) => capture.outs.push(m),
    stderr: (m) => capture.errs.push(m),
    now,
    ...overrides,
  };
  return { opts, capture, store: testStore };
}

describe("runSprint — dry-run", () => {
  it("prints a plan preview and exits 0 without writing artifacts", async () => {
    const { opts, capture, store } = makeOpts({ dryRun: true });
    const res = await runSprint(opts);
    expect(res.exitCode).toBe(0);
    expect(store!.written).toHaveLength(0);
    expect(res.plan_id).toBeNull();
    expect(res.result_id).toBeNull();
    const joined = capture.outs.join("\n");
    expect(joined).toContain("[dry-run]");
    expect(joined).toContain("test goal");
  });
});

describe("runSprint — happy path with mock worker", () => {
  it("runs all tasks, writes Plan + Decision, reports total cost", async () => {
    const { opts, store } = makeOpts();
    const res = await runSprint(opts);
    expect(res.exitCode).toBe(0);
    expect(res.tasks_completed).toBe(2);
    expect(res.tasks_failed).toBe(0);
    expect(res.total_cost_usd).toBeCloseTo(0.1, 5);
    expect(store!.written).toHaveLength(2);
    expect(store!.written[0].type).toBe("Plan");
    expect(store!.written[1].type).toBe("Decision");
    expect(res.plan_id).toBe(store!.written[0].id);
    expect(res.result_id).toBe(store!.written[1].id);
  });

  it("chooses 'ship the work' when every task succeeds", async () => {
    const { opts, store } = makeOpts();
    await runSprint(opts);
    const decision = store!.written[1] as Decision;
    expect(decision.chosen).toBe("ship the work");
  });
});

describe("runSprint — concurrency bound", () => {
  it("never runs more than maxAgents workers at the same time", async () => {
    let inFlight = 0;
    let peakConcurrency = 0;
    const resolvers: Array<() => void> = [];
    const gate = async (): Promise<void> =>
      new Promise<void>((resolve) => resolvers.push(resolve));

    const worker: Worker = async (task) => {
      inFlight += 1;
      peakConcurrency = Math.max(peakConcurrency, inFlight);
      await gate();
      inFlight -= 1;
      return {
        task_id: task.id,
        ok: true,
        output: "ok",
        cost_usd: 0.01,
        duration_ms: 1,
      };
    };

    const tasks: SprintTask[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      prompt: `task ${i}`,
    }));

    const { opts } = makeOpts({ tasks, maxAgents: 2, worker, store: null });
    const runPromise = runSprint(opts);

    for (let i = 0; i < 5; i++) {
      while (resolvers.length === 0) {
        await new Promise<void>((r) => setImmediate(r));
      }
      resolvers.shift()!();
      await new Promise<void>((r) => setImmediate(r));
    }

    const res = await runPromise;
    expect(res.exitCode).toBe(0);
    expect(res.tasks_completed).toBe(5);
    expect(peakConcurrency).toBeLessThanOrEqual(2);
    expect(peakConcurrency).toBeGreaterThan(0);
  });
});

describe("runSprint — budget cap", () => {
  it("stops dispatching new tasks once 80% of budget is consumed", async () => {
    const tasks: SprintTask[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      prompt: `task ${i}`,
    }));
    const expensiveWorker: Worker = async (task) => ({
      task_id: task.id,
      ok: true,
      output: "ok",
      cost_usd: 3,
      duration_ms: 1,
    });
    const { opts, capture } = makeOpts({
      tasks,
      maxAgents: 1,
      budgetUsd: 10,
      worker: expensiveWorker,
      store: null,
    });
    const res = await runSprint(opts);
    expect(res.tasks_completed).toBe(3);
    expect(res.tasks_skipped_budget).toBe(2);
    expect(res.total_cost_usd).toBe(9);
    expect(capture.outs.join("\n")).toContain("budget cap reached");
  });
});

describe("runSprint — worker failures", () => {
  it("returns exit 1 and records the error when a worker reports ok=false", async () => {
    const failingWorker: Worker = async (task) => ({
      task_id: task.id,
      ok: false,
      output: "",
      cost_usd: 0,
      duration_ms: 1,
      error: "synthetic failure",
    });
    const { opts, store } = makeOpts({ worker: failingWorker });
    const res = await runSprint(opts);
    expect(res.exitCode).toBe(1);
    expect(res.tasks_failed).toBe(2);
    const decision = store!.written[1] as Decision;
    expect(decision.chosen).toBe("retry failed tasks");
  });

  it("catches thrown errors and records them as failed tasks", async () => {
    const throwingWorker: Worker = async () => {
      throw new Error("boom");
    };
    const { opts } = makeOpts({ worker: throwingWorker, store: null });
    const res = await runSprint(opts);
    expect(res.exitCode).toBe(1);
    expect(res.tasks_failed).toBe(2);
    expect(res.worker_results.every((r) => r.error === "boom")).toBe(true);
  });
});

describe("runSprint — input validation", () => {
  it("rejects an empty task list with exit 2", async () => {
    const { opts, capture } = makeOpts({ tasks: [], store: null });
    const res = await runSprint(opts);
    expect(res.exitCode).toBe(2);
    expect(capture.errs.join("\n")).toContain("no tasks");
  });

  it("rejects maxAgents < 1 with exit 2", async () => {
    const { opts, capture } = makeOpts({ maxAgents: 0, store: null });
    const res = await runSprint(opts);
    expect(res.exitCode).toBe(2);
    expect(capture.errs.join("\n")).toMatch(/max-agents/);
  });
});

describe("notImplementedWorker", () => {
  it("throws a clear error directing users to --worker mock", async () => {
    await expect(
      notImplementedWorker({ id: "t", prompt: "p" }),
    ).rejects.toThrow(/--worker mock/);
  });
});

describe("defaultTasksFromGoal", () => {
  it("returns two tasks: one investigate, one critique, both mentioning the goal", () => {
    const tasks = defaultTasksFromGoal("ship feature X");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].prompt).toContain("ship feature X");
    expect(tasks[1].prompt).toContain("ship feature X");
    expect(tasks[0].agent).toBe("claude");
    expect(tasks[1].agent).toBe("codex");
  });
});

describe("loadTasksFromFile", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "quorum-sprint-test-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("loads a valid task array", async () => {
    const path = join(tmp, "tasks.json");
    writeFileSync(
      path,
      JSON.stringify([
        { id: "a", prompt: "do a", agent: "claude" },
        { id: "b", prompt: "do b" },
      ]),
    );
    const tasks = await loadTasksFromFile(path);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].agent).toBe("claude");
    expect(tasks[1].agent).toBeUndefined();
  });

  it("rejects non-array JSON", async () => {
    const path = join(tmp, "bad.json");
    writeFileSync(path, JSON.stringify({ not: "an array" }));
    await expect(loadTasksFromFile(path)).rejects.toThrow(/expected a JSON array/);
  });

  it("rejects items missing id or prompt", async () => {
    const path = join(tmp, "bad.json");
    writeFileSync(path, JSON.stringify([{ prompt: "x" }]));
    await expect(loadTasksFromFile(path)).rejects.toThrow(/missing required/);
  });

  it("ignores unknown agent values (treats as undefined)", async () => {
    const path = join(tmp, "ok.json");
    writeFileSync(
      path,
      JSON.stringify([{ id: "a", prompt: "x", agent: "gemini" }]),
    );
    const [t] = await loadTasksFromFile(path);
    expect(t.agent).toBeUndefined();
  });
});
