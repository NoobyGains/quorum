// `quorum sprint <goal>` — MVP of Max Sprint Mode (issue #78).
//
// Dispatches N parallel workers under a hard USD budget ceiling, publishes a
// Plan artifact at start and a Decision artifact at end with the full result
// set. Worker implementation is pluggable: tests inject a mock; the real
// worker (shell to `claude -p`) is not wired yet — see the notImplementedWorker
// stub below.

import { readFile } from "node:fs/promises";

import {
  createPlan,
  createDecision,
  type Plan,
  type Decision,
} from "@quorum/artifacts";

/** One atomic unit of work a sprint dispatches to a worker. */
export interface SprintTask {
  id: string;
  prompt: string;
  /** Optional vendor hint. Workers may ignore it. */
  agent?: "claude" | "codex";
  /** Optional per-task spend cap (USD). Overrides global budget share. */
  max_cost_usd?: number;
}

/** What a worker returns after running a task. */
export interface WorkerResult {
  task_id: string;
  ok: boolean;
  /** Free-form output — typically the agent's final message text. */
  output: string;
  /** Dollars this task cost, as reported by the worker. */
  cost_usd: number;
  duration_ms: number;
  /** Populated when ok=false. */
  error?: string;
}

/** Pluggable worker function signature. */
export type Worker = (task: SprintTask) => Promise<WorkerResult>;

/** Minimal artifact-store contract. Sprint writes two artifacts. */
export interface SprintStore {
  write(artifact: Plan | Decision): Promise<void>;
}

export interface SprintOptions {
  goal: string;
  tasks: readonly SprintTask[];
  maxAgents: number;
  budgetUsd: number;
  dryRun: boolean;
  worker: Worker;
  /** `null` disables artifact writes (useful for pure unit tests). */
  store: SprintStore | null;
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
  /** Clock source for deterministic tests. */
  now: () => Date;
  /** Author name stamped on artifacts. Defaults to "sprint-conductor". */
  author?: string;
  /** Project name for artifacts. Defaults to "quorum". */
  project?: string;
}

export interface SprintRunResult {
  exitCode: 0 | 1 | 2;
  tasks_completed: number;
  tasks_failed: number;
  tasks_skipped_budget: number;
  total_cost_usd: number;
  plan_id: string | null;
  result_id: string | null;
  worker_results: WorkerResult[];
}

/** The default worker stub — real `claude -p` spawning is issue #78 follow-up. */
export const notImplementedWorker: Worker = async (task) => {
  throw new Error(
    `real worker not implemented yet — pass --worker mock to test orchestration. task=${task.id}`,
  );
};

/** Deterministic mock worker: returns a canned output + small cost. */
export function makeMockWorker(
  overrides: Partial<WorkerResult> = {},
): Worker {
  return async (task) => ({
    task_id: task.id,
    ok: true,
    output: `[mock] ${task.prompt.slice(0, 80)}`,
    cost_usd: 0.05,
    duration_ms: 1,
    ...overrides,
  });
}

/**
 * Core sprint loop. Respects `maxAgents` as a concurrency ceiling and
 * `budgetUsd` as a hard stop for scheduling NEW tasks (in-flight tasks
 * always finish; the stop just halts further dispatch at 80% consumed).
 */
export async function runSprint(opts: SprintOptions): Promise<SprintRunResult> {
  const author = opts.author ?? "sprint-conductor";
  const project = opts.project ?? "quorum";

  if (opts.tasks.length === 0) {
    opts.stderr("no tasks to run");
    return {
      exitCode: 2,
      tasks_completed: 0,
      tasks_failed: 0,
      tasks_skipped_budget: 0,
      total_cost_usd: 0,
      plan_id: null,
      result_id: null,
      worker_results: [],
    };
  }
  if (opts.maxAgents < 1) {
    opts.stderr(`max-agents must be >= 1, got ${opts.maxAgents}`);
    return {
      exitCode: 2,
      tasks_completed: 0,
      tasks_failed: 0,
      tasks_skipped_budget: 0,
      total_cost_usd: 0,
      plan_id: null,
      result_id: null,
      worker_results: [],
    };
  }

  if (opts.dryRun) {
    opts.stdout(`[dry-run] goal: ${opts.goal}`);
    opts.stdout(
      `[dry-run] ${opts.tasks.length} task(s), max-agents=${opts.maxAgents}, budget-usd=${opts.budgetUsd}`,
    );
    for (const t of opts.tasks) {
      opts.stdout(
        `[dry-run]   ${t.id}${t.agent ? ` (${t.agent})` : ""}: ${t.prompt.slice(0, 80)}`,
      );
    }
    return {
      exitCode: 0,
      tasks_completed: 0,
      tasks_failed: 0,
      tasks_skipped_budget: 0,
      total_cost_usd: 0,
      plan_id: null,
      result_id: null,
      worker_results: [],
    };
  }

  // Publish the start-of-sprint Plan.
  let planId: string | null = null;
  if (opts.store) {
    const plan = createPlan({
      id: `pln_${randomSuffix(opts.now())}`,
      author,
      project,
      created: opts.now().toISOString(),
      goal: `sprint: ${opts.goal}`,
      approach: `parallel dispatch of ${opts.tasks.length} task(s) at max-agents=${opts.maxAgents}, budget=${opts.budgetUsd} USD`,
      files_touched: [],
      assumptions: [
        `each worker reports its own cost_usd; budget cap is 80% of ${opts.budgetUsd}`,
      ],
      confidence: 0.6,
      blast_radius: opts.tasks.length > 5 ? "large" : "medium",
      estimated_tokens: opts.tasks.length * 2000,
      risk_flags: [],
      status: "approved",
    });
    await opts.store.write(plan);
    planId = plan.id;
    opts.stdout(`[sprint] published plan ${plan.id}`);
  }

  const budgetStopAt = opts.budgetUsd * 0.8;
  const queue = [...opts.tasks];
  const inFlight = new Set<Promise<void>>();
  const workerResults: WorkerResult[] = [];
  let totalCost = 0;
  let budgetStopped = false;

  const drain = async (): Promise<void> => {
    if (inFlight.size === 0) return;
    await Promise.race(inFlight);
  };

  while (queue.length > 0 || inFlight.size > 0) {
    if (budgetStopped && inFlight.size === 0) break;

    if (
      !budgetStopped &&
      queue.length > 0 &&
      inFlight.size < opts.maxAgents &&
      totalCost < budgetStopAt
    ) {
      const task = queue.shift()!;
      const started = Date.now();
      opts.stdout(`[sprint] → ${task.id}`);
      const p = (async () => {
        try {
          const r = await opts.worker(task);
          workerResults.push(r);
          totalCost += r.cost_usd;
          const tag = r.ok ? "✓" : "✗";
          opts.stdout(
            `[sprint] ${tag} ${r.task_id} ($${r.cost_usd.toFixed(2)}, ${r.duration_ms}ms) — total spent $${totalCost.toFixed(2)}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const r: WorkerResult = {
            task_id: task.id,
            ok: false,
            output: "",
            cost_usd: 0,
            duration_ms: Date.now() - started,
            error: msg,
          };
          workerResults.push(r);
          opts.stdout(`[sprint] ✗ ${task.id} — ${msg}`);
        }
      })();
      inFlight.add(p);
      p.finally(() => inFlight.delete(p));
      continue;
    }

    if (totalCost >= budgetStopAt && !budgetStopped && queue.length > 0) {
      budgetStopped = true;
      opts.stdout(
        `[sprint] budget cap reached ($${totalCost.toFixed(2)} ≥ $${budgetStopAt.toFixed(2)}); letting ${inFlight.size} in-flight task(s) finish, ${queue.length} deferred`,
      );
    }

    await drain();
  }

  const completed = workerResults.filter((r) => r.ok).length;
  const failed = workerResults.filter((r) => !r.ok).length;
  const skipped = opts.tasks.length - workerResults.length;

  // Publish the Decision artifact summarizing the sprint.
  let resultId: string | null = null;
  if (opts.store) {
    const summary =
      failed === 0 && skipped === 0
        ? `all ${completed} task(s) completed under budget`
        : `${completed} succeeded, ${failed} failed, ${skipped} deferred by budget; $${totalCost.toFixed(2)} spent`;
    const decision = createDecision({
      id: `dcs_${randomSuffix(opts.now())}`,
      author,
      project,
      created: opts.now().toISOString(),
      question: `sprint outcome: ${opts.goal}`,
      options: ["ship the work", "retry failed tasks", "cancel sprint"],
      chosen: failed === 0 && skipped === 0 ? "ship the work" : "retry failed tasks",
      rationale: summary,
      signed_by: [author],
      expires: null,
    });
    await opts.store.write(decision);
    resultId = decision.id;
    opts.stdout(`[sprint] published decision ${decision.id}`);
  }

  opts.stdout(
    `[sprint] done: ${completed}/${opts.tasks.length} succeeded, $${totalCost.toFixed(2)} spent`,
  );

  return {
    exitCode: failed > 0 ? 1 : 0,
    tasks_completed: completed,
    tasks_failed: failed,
    tasks_skipped_budget: skipped,
    total_cost_usd: totalCost,
    plan_id: planId,
    result_id: resultId,
    worker_results: workerResults,
  };
}

/** Read a JSON tasks file as `SprintTask[]`. Throws on malformed input. */
export async function loadTasksFromFile(path: string): Promise<SprintTask[]> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON array of tasks`);
  }
  const tasks: SprintTask[] = [];
  for (const [idx, item] of parsed.entries()) {
    if (!item || typeof item !== "object") {
      throw new Error(`${path}[${idx}]: expected an object`);
    }
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.prompt !== "string") {
      throw new Error(`${path}[${idx}]: missing required id / prompt`);
    }
    tasks.push({
      id: o.id,
      prompt: o.prompt,
      agent:
        o.agent === "claude" || o.agent === "codex" ? o.agent : undefined,
      max_cost_usd:
        typeof o.max_cost_usd === "number" ? o.max_cost_usd : undefined,
    });
  }
  return tasks;
}

/**
 * Derive a minimal default task list from a goal when no --tasks file is
 * given. Produces two tasks: one investigation, one implementation-sketch.
 * Callers who want real work should pass --tasks.
 */
export function defaultTasksFromGoal(goal: string): SprintTask[] {
  return [
    {
      id: "t_investigate",
      prompt: `Investigate the repo and report one concrete finding relevant to: ${goal}`,
      agent: "claude",
    },
    {
      id: "t_critique",
      prompt: `Identify the biggest risk in pursuing: ${goal}`,
      agent: "codex",
    },
  ];
}

function randomSuffix(d: Date): string {
  // Short, artifact-id-compatible (alnum) suffix. Uses timestamp + random.
  const stamp = d.getTime().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0");
  return `${stamp}${rand}`.slice(-12);
}
