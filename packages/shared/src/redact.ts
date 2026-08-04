/**
 * Heuristic secret scrubber on persist (Phase 8.4 / SAF-3).
 * Replaces token-like substrings before artifacts are written to disk.
 */

export type RedactPattern = {
  name: string;
  pattern: RegExp;
  replacement: string;
};

/** Patterns aligned with TRD §13 (ghp_, AWS keys, private keys, common API tokens). */
export const REDACT_PATTERNS: readonly RedactPattern[] = [
  {
    name: "github_pat",
    pattern: /ghp_[A-Za-z0-9]{20,}/g,
    replacement: "ghp_[REDACTED]",
  },
  {
    name: "github_oauth",
    pattern: /gho_[A-Za-z0-9]{20,}/g,
    replacement: "gho_[REDACTED]",
  },
  {
    name: "github_pat_v2",
    pattern: /github_pat_[A-Za-z0-9_]{20,}/g,
    replacement: "github_pat_[REDACTED]",
  },
  {
    name: "openai_sk",
    pattern: /sk-[A-Za-z0-9]{20,}/g,
    replacement: "sk-[REDACTED]",
  },
  {
    name: "aws_access_key",
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: "AKIA[REDACTED]",
  },
  {
    name: "private_key_block",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    name: "assignment_secret",
    pattern:
      /((?:api[_-]?key|token|secret|password|passwd|auth)\s*[=:]\s*['"]?)[A-Za-z0-9_\-./+=]{8,}/gi,
    replacement: "$1[REDACTED]",
  },
];

/**
 * Scrub secret-looking substrings from text before persistence.
 * Idempotent for already-redacted placeholders.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACT_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** True when any pattern would change the input. */
export function containsRedactableSecrets(text: string): boolean {
  for (const { pattern } of REDACT_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}
