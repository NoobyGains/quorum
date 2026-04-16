import { randomUUID } from "node:crypto";

import {
  createHandoff,
  isHandoff,
  type Handoff,
} from "@quorum/artifacts";
import type { Store } from "@quorum/store";

export interface HandoffPlan {
  summary: string;
  what_failed?: string | null;
  lesson?: string | null;
  open_questions: string[];
  suggested_next?: string | null;
  confidence_drift: number;
}

interface PublishHandoffInput extends HandoffPlan {
  from: string;
  project: string;
  author?: string;
  id?: string;
  created?: string;
  version?: number;
  supersedes?: string | null;
  signatures?: Handoff["signatures"];
}

function nextHandoffId(): string {
  return `hnd_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function publishHandoff(
  store: Pick<Store, "write">,
  input: PublishHandoffInput,
): Promise<Handoff> {
  const artifact = createHandoff({
    id: input.id ?? nextHandoffId(),
    author: input.author ?? input.from,
    project: input.project,
    created: input.created,
    version: input.version,
    supersedes: input.supersedes,
    signatures: input.signatures,
    from: input.from,
    summary: input.summary,
    what_failed: input.what_failed ?? null,
    lesson: input.lesson ?? null,
    open_questions: [...input.open_questions],
    suggested_next: input.suggested_next ?? null,
    confidence_drift: input.confidence_drift,
  });

  await store.write(artifact);
  return artifact;
}

export async function latestHandoffFor(
  store: Pick<Store, "list">,
  agent: string,
): Promise<Handoff | null> {
  const handoffs = (await store.list({ type: "Handoff" }))
    .filter(isHandoff)
    .filter((handoff) => handoff.from !== agent);

  if (handoffs.length === 0) {
    return null;
  }

  return handoffs.reduce((latest, current) =>
    current.created > latest.created ? current : latest,
  );
}

export function formatHandoffForContext(
  handoff: Handoff | null | undefined,
): string {
  if (!handoff) {
    return "";
  }

  const lines: string[] = [
    `## Handoff from ${handoff.from} (${handoff.created})`,
    "",
    handoff.summary,
  ];

  if (handoff.lesson) {
    lines.push("", `Lesson: ${handoff.lesson}`);
  }

  lines.push("", "Open questions:");
  if (handoff.open_questions.length > 0) {
    for (const question of handoff.open_questions) {
      lines.push(`- ${question}`);
    }
  } else {
    lines.push("(none)");
  }

  if (handoff.suggested_next) {
    lines.push("", `Suggested next: ${handoff.suggested_next}`);
  }

  lines.push("", `Confidence drift: ${handoff.confidence_drift}`);

  return lines.join("\n");
}
