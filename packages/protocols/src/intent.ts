import {
  isDisagreement,
  isPlan,
  type Disagreement,
  type Plan,
} from "@quorum/artifacts";
import type { Store } from "@quorum/store";

export type IntentStatus =
  | "objection_window"
  | "approved"
  | "blocked"
  | "superseded";

export interface IntentConfig {
  objectionWindowMs: number;
  now: () => number;
}

export const DEFAULT_INTENT_CONFIG: IntentConfig = {
  objectionWindowMs: 10_000,
  now: () => Date.now(),
};

export interface IntentEvaluation {
  status: IntentStatus;
  closesAt: number;
  blockingDisagreements: Disagreement[];
}

function findBlockingDisagreements(
  plan: Plan,
  disagreements: readonly Disagreement[],
): Disagreement[] {
  return disagreements.filter(
    (disagreement) =>
      disagreement.target === plan.id &&
      disagreement.severity === "blocks_merge" &&
      disagreement.status === "open",
  );
}

export function computePlanStatus(
  plan: Plan,
  disagreements: readonly Disagreement[],
  config: IntentConfig,
): IntentStatus {
  return evaluateIntent(plan, disagreements, config).status;
}

export function evaluateIntent(
  plan: Plan,
  disagreements: readonly Disagreement[],
  config: IntentConfig,
): IntentEvaluation {
  const closesAt = Date.parse(plan.created) + config.objectionWindowMs;
  const blockingDisagreements = findBlockingDisagreements(plan, disagreements);

  const status: IntentStatus =
    plan.status === "superseded"
      ? "superseded"
      : blockingDisagreements.length > 0
        ? "blocked"
        : config.now() < closesAt
          ? "objection_window"
          : "approved";

  return {
    status,
    closesAt,
    blockingDisagreements,
  };
}

export async function refreshPlanStatus(
  store: Pick<Store, "read" | "list">,
  planId: string,
  config: IntentConfig = DEFAULT_INTENT_CONFIG,
): Promise<IntentEvaluation> {
  const artifact = await store.read(planId);
  if (!artifact) {
    throw new Error(`Plan not found: ${planId}`);
  }
  if (!isPlan(artifact)) {
    throw new Error(`Artifact ${planId} is not a Plan`);
  }

  const disagreements = (await store.list({ type: "Disagreement" })).filter(
    isDisagreement,
  );

  return evaluateIntent(artifact, disagreements, config);
}
