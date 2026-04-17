import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createHandoff, isHandoff } from "@quorum/artifacts";
import { Store } from "@quorum/store";

import {
  formatHandoffForContext,
  latestHandoffFor,
  publishHandoff,
} from "./handoff.js";

function makeHandoff(
  id = "hnd_base",
  overrides: Partial<Parameters<typeof createHandoff>[0]> = {},
) {
  return createHandoff({
    id,
    author: "claude",
    project: "quorum-test",
    from: "claude",
    created: "2026-04-16T14:32:18Z",
    summary: "Shipped #47.",
    what_failed: null,
    lesson: "Check decisions first.",
    open_questions: ["Should we backport this?"],
    suggested_next: "#48",
    confidence_drift: -0.02,
    ...overrides,
  });
}

describe("handoff protocol", () => {
  let tempHome: string;
  let store: Store;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "quorum-protocols-handoff-"));
    store = new Store("/fake/project/protocols-handoff", {
      homeDir: tempHome,
    });
  });

  afterEach(async () => {
    await store.close();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("publishHandoff writes a Handoff artifact and returns the stored fields", async () => {
    const handoff = await publishHandoff(store, {
      from: "claude",
      project: "quorum-test",
      summary: "Shipped #47.",
      what_failed: "Initial plan missed a decision.",
      lesson: "Check decisions first.",
      open_questions: ["Should we backport this?"],
      suggested_next: "#48",
      confidence_drift: -0.02,
    });

    expect(handoff.type).toBe("Handoff");
    expect(handoff.id).toMatch(/^hnd_[a-z0-9]+$/);
    expect(handoff.author).toBe("claude");
    expect(handoff.from).toBe("claude");
    expect(handoff.summary).toBe("Shipped #47.");

    const persisted = await store.read(handoff.id);
    expect(isHandoff(persisted)).toBe(true);
    if (!isHandoff(persisted)) {
      throw new Error("expected a persisted Handoff");
    }

    expect(persisted.summary).toBe("Shipped #47.");
    expect(persisted.lesson).toBe("Check decisions first.");
  });

  it("latestHandoffFor returns null when there are no handoffs", async () => {
    await expect(latestHandoffFor(store, "codex")).resolves.toBeNull();
  });

  it("latestHandoffFor returns the newest handoff among agents other than the caller", async () => {
    await store.write(
      makeHandoff("hnd_old", {
        author: "claude",
        from: "claude",
        created: "2026-04-16T10:00:00Z",
      }),
    );
    await store.write(
      makeHandoff("hnd_self", {
        author: "codex",
        from: "codex",
        created: "2026-04-16T12:00:00Z",
      }),
    );
    await store.write(
      makeHandoff("hnd_new", {
        author: "claude",
        from: "claude",
        created: "2026-04-16T11:00:00Z",
      }),
    );

    const latest = await latestHandoffFor(store, "codex");

    expect(latest?.id).toBe("hnd_new");
  });

  it("formatHandoffForContext produces the expected Markdown", () => {
    const markdown = formatHandoffForContext(
      makeHandoff("hnd_fmt", {
        created: "2026-04-16T14:32:18Z",
        summary: "Shipped #47.",
        lesson: "Check decisions first.",
        open_questions: [
          "Should we backport this?",
          "Do we need an alert?",
        ],
        suggested_next: "#48",
        confidence_drift: -0.02,
      }),
    );

    expect(markdown).toBe(`## Handoff from claude (2026-04-16T14:32:18Z)

Shipped #47.

Lesson: Check decisions first.

Open questions:
- Should we backport this?
- Do we need an alert?

Suggested next: #48

Confidence drift: -0.02`);
  });

  it("formatHandoffForContext handles nullable fields gracefully", () => {
    const markdown = formatHandoffForContext(
      makeHandoff("hnd_nulls", {
        summary: "Still investigating.",
        what_failed: null,
        lesson: null,
        open_questions: [],
        suggested_next: null,
        confidence_drift: 0,
      }),
    );

    expect(markdown).toContain(`## Handoff from claude (2026-04-16T14:32:18Z)

Still investigating.

Open questions:
(none)

Confidence drift: 0`);
    expect(markdown).not.toContain("Lesson:");
    expect(markdown).not.toContain("Suggested next:");
    expect(formatHandoffForContext(null)).toBe("");
    expect(formatHandoffForContext(undefined)).toBe("");
  });
});
