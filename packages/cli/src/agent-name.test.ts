import { describe, expect, it } from "vitest";

import { AGENT_NAME_PATTERN, validateAgentName } from "./agent-name.js";

describe("validateAgentName", () => {
  const VALID = [
    "claude",
    "codex",
    "claude-w08",
    "agent_1",
    "a",
    "a".repeat(64),
  ];
  for (const name of VALID) {
    it(`accepts ${JSON.stringify(name)}`, () => {
      expect(() => validateAgentName(name)).not.toThrow();
    });
  }

  const INVALID: Array<[string, unknown]> = [
    ["path traversal", "../../../x"],
    ["leading dot", ".hidden"],
    ["forward slash", "a/b"],
    ["backslash", "a\\b"],
    ["null byte", "a\0b"],
    ["empty", ""],
    ["too long (65 chars)", "a".repeat(65)],
    ["leading digit", "1agent"],
    ["leading hyphen", "-agent"],
    ["uppercase", "Claude"],
    ["whitespace", "ag ent"],
    ["unicode", "agènt"],
    ["non-string null", null],
    ["non-string number", 1],
  ];
  for (const [label, name] of INVALID) {
    it(`rejects ${label} (${JSON.stringify(name)})`, () => {
      expect(() => validateAgentName(name as string)).toThrow(
        /Invalid agent name/,
      );
    });
  }

  it("exports the regex as a single source of truth", () => {
    expect(AGENT_NAME_PATTERN.test("claude")).toBe(true);
    expect(AGENT_NAME_PATTERN.test("../x")).toBe(false);
  });
});
