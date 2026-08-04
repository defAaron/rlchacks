/**
 * Freshness shape for MCP tool responses (TRD §8.2 / MCP-6 partial).
 */

import type { FreshnessSummary } from "@graft/retrieval";

export type McpFreshness = {
  ingestAt: string | null;
  compileAt: string | null;
  episodes: number;
  recipes: number;
  stale: boolean;
  reason: string | null;
};

export function toMcpFreshness(summary: FreshnessSummary): McpFreshness {
  return {
    ingestAt: summary.ingestAt,
    compileAt: summary.compileAt,
    episodes: summary.episodeCount,
    recipes: summary.recipeCount,
    stale: summary.stale,
    reason: summary.reason,
  };
}
