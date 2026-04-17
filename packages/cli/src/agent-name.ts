// Agent-name validation. Agent names appear in filenames (inbox watermark),
// artifact `author` fields, and presence rollups — anywhere they're used as
// a filesystem segment, an unvalidated caller-supplied value is a
// path-traversal surface (issue #60).
//
// Rules:
//   - 1-64 chars
//   - must start with a lowercase letter
//   - otherwise lowercase alpha, digits, underscore, or hyphen
//
// Examples that pass: `claude`, `codex`, `claude-w08`, `agent_1`
// Examples that fail: `../../x`, `.hidden`, `a/b`, `a\b`, `a\0b`, ``, 65-char name

export const AGENT_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * Throws with an actionable message if `name` is not a legal agent name.
 * Called at every CLI entry point that uses the name in a file path.
 */
export function validateAgentName(name: string): void {
  if (typeof name !== "string" || !AGENT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid agent name ${JSON.stringify(name)}: must match ${AGENT_NAME_PATTERN} ` +
        "(lowercase letter first; then lowercase alnum, _, or -; 1-64 chars)",
    );
  }
}
