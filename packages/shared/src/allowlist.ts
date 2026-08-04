/**
 * Multi-repo allowlist (Phase 8.5 / SAF-1).
 */

import { GraftError, GraftErrorCodes } from "./errors.js";
import { parseRepoSlug } from "./paths.js";

/** Parse comma-separated `GRAFT_REPO_ALLOWLIST` (null = unrestricted). */
export function parseRepoAllowlist(
  raw: string | undefined,
): string[] | null {
  if (raw === undefined || raw.trim() === "") {
    return null;
  }
  const slugs = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const slug of slugs) {
    parseRepoSlug(slug);
  }
  return slugs.map((s) => {
    const { owner, name } = parseRepoSlug(s);
    return `${owner}/${name}`;
  });
}

/** Normalize slug for allowlist comparison. */
export function normalizeRepoSlug(slug: string): string {
  const { owner, name } = parseRepoSlug(slug);
  return `${owner}/${name}`;
}

/**
 * Refuse repo access when an allowlist is configured and the slug is absent.
 * @throws GraftError GRAFT_REPO_FORBIDDEN
 */
export function assertRepoAllowed(
  repoSlug: string,
  allowlist: string[] | null,
): void {
  if (allowlist === null || allowlist.length === 0) {
    return;
  }
  const normalized = normalizeRepoSlug(repoSlug);
  const allowed = allowlist.some(
    (entry) => normalizeRepoSlug(entry) === normalized,
  );
  if (!allowed) {
    throw new GraftError(
      GraftErrorCodes.GRAFT_REPO_FORBIDDEN,
      `Repo "${normalized}" is not in GRAFT_REPO_ALLOWLIST (${allowlist.join(", ")})`,
    );
  }
}
