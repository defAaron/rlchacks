/**
 * Freshness / stale detection (Phase 4.5 / TRD §7.5).
 */

import { readCursors } from "@graft/pipeline";
import { readEpisodeIndex } from "@graft/compile";
import { readRecipeIndex } from "@graft/compile";

export type FreshnessSummary = {
  repo: string;
  stale: boolean;
  reason: string | null;
  ingestAt: string | null;
  linkAt: string | null;
  compileAt: string | null;
  episodeCount: number;
  recipeCount: number;
};

export async function getFreshnessSummary(
  dataDir: string,
  owner: string,
  name: string,
): Promise<FreshnessSummary> {
  const repo = `${owner}/${name}`;
  const cursors = await readCursors(dataDir, owner, name);
  const episodeIndex = await readEpisodeIndex(dataDir, owner, name);
  const recipeIndex = await readRecipeIndex(dataDir, owner, name);

  const ingestAt = cursors?.ingest.lastMergedAt ?? null;
  const linkAt = cursors?.link.updatedAt ?? null;
  const compileAt = cursors?.compile.updatedAt ?? null;
  const episodeCount = episodeIndex?.episodes.length ?? 0;
  const recipeCount = recipeIndex?.recipes.length ?? 0;

  let stale = false;
  let reason: string | null = null;

  if (linkAt !== null && compileAt === null) {
    stale = true;
    reason = "Episodes linked but recipes not compiled since last link.";
  } else if (
    linkAt !== null &&
    compileAt !== null &&
    linkAt > compileAt
  ) {
    stale = true;
    reason = "Link watermark is newer than last compile — re-run graft compile.";
  } else if (
    ingestAt !== null &&
    compileAt !== null &&
    ingestAt > compileAt
  ) {
    stale = true;
    reason = "New PRs ingested since last compile — re-run graft compile.";
  }

  return {
    repo,
    stale,
    reason,
    ingestAt,
    linkAt,
    compileAt,
    episodeCount,
    recipeCount,
  };
}

export function formatStaleBanner(summary: FreshnessSummary): string | null {
  if (!summary.stale || summary.reason === null) {
    return null;
  }
  return `⚠ STALE: ${summary.reason}`;
}
