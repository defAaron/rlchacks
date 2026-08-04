/**
 * suggestGrafts orchestration (Phase 4.4).
 */

import { loadEpisodesByIds } from "@graft/compile";
import type { GraftSuggestion, RewriteRecipe } from "@graft/shared";
import { DEFAULT_LIST_LIMIT } from "./list-recipes.js";
import {
  candidatesToSuggestions,
  matchDiffToRecipes,
  type MatchContext,
} from "./match.js";
import { buildPatchForMatch } from "./patch.js";

export type SuggestGraftsOptions = {
  dataDir: string;
  owner: string;
  name: string;
  recipes: readonly RewriteRecipe[];
  diff?: string;
  files?: Array<{ path: string; content: string }>;
  pathHint?: string;
  limit?: number;
};

export type SuggestGraftsResult = {
  suggestions: GraftSuggestion[];
  warnings: string[];
};

export async function suggestGrafts(
  options: SuggestGraftsOptions,
): Promise<SuggestGraftsResult> {
  const episodeIds = [
    ...new Set(options.recipes.flatMap((r) => r.episodeIds)),
  ];
  const episodesById = await loadEpisodesByIds(
    options.dataDir,
    options.owner,
    options.name,
    episodeIds,
  );

  const ctx: MatchContext = {
    recipes: options.recipes,
    episodesById,
    limit: options.limit ?? DEFAULT_LIST_LIMIT,
  };
  if (options.diff !== undefined) {
    ctx.diff = options.diff;
  }
  if (options.files !== undefined) {
    ctx.files = options.files;
  }
  if (options.pathHint !== undefined) {
    ctx.pathHint = options.pathHint;
  }

  const candidates = matchDiffToRecipes(ctx);
  const warnings: string[] = [];

  const suggestions = candidatesToSuggestions(
    candidates,
    episodesById,
    (c) => {
      const built = buildPatchForMatch(c);
      warnings.push(...built.warnings);
      return built.patch;
    },
    options.limit ?? DEFAULT_LIST_LIMIT,
  );

  return { suggestions, warnings: [...new Set(warnings)] };
}
