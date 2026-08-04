import { createHash } from "node:crypto";

/**
 * Stable episode id from repo + comment id (TRD: stable hash).
 * Format: `ep_` + first 16 hex chars of sha256.
 */
export function stableEpisodeId(repo: string, commentId: string): string {
  const digest = createHash("sha256")
    .update(`${repo.trim()}\0${commentId.trim()}`, "utf8")
    .digest("hex");
  return `ep_${digest.slice(0, 16)}`;
}
