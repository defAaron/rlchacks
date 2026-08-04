import { createHash } from "node:crypto";

/** Stable recipe id from repo + medoid episode ids (sorted). */
export function stableRecipeId(
  repo: string,
  episodeIds: readonly string[],
): string {
  const sorted = [...episodeIds].sort();
  const digest = createHash("sha256")
    .update(`${repo.trim()}\0${sorted.join("\0")}`, "utf8")
    .digest("hex");
  return `rcp_${digest.slice(0, 16)}`;
}

/** Compile run id from timestamp + repo. */
export function newCompileRunId(repo: string, now: Date): string {
  const digest = createHash("sha256")
    .update(`${repo}\0${now.toISOString()}`, "utf8")
    .digest("hex");
  return `compile_${digest.slice(0, 12)}`;
}
